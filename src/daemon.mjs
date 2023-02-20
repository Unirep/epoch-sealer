import { Synchronizer, schema } from '@unirep/core'
import { Circuit, BuildOrderedTree } from '@unirep/core'
import { SQLiteConnector } from 'anondb/node'
import TransactionManager from './singletons/TransactionManager.mjs'

const { UNIREP_ADDRESS, ETH_PROVIDER_URL, ATTESTER_ADDRESS, PRIVATE_KEY } =
  Object.assign(process.env, {
    ATTESTER_ADDRESS: 0,
  })

const provider = ETH_PROVIDER_URL.startsWith('http')
  ? new ethers.providers.JsonRpcProvider(ETH_PROVIDER_URL)
  : new ethers.providers.WebSocketProvider(ETH_PROVIDER_URL)

TransactionManager.configure(PRIVATE_KEY, provider)
await TransactionManager.start()

const db = new SQLiteConnector(schema, ':memory:')

const synchronizer = new Synchronizer({
  prover: {}, // TODO: remove this from the synchronizer
  unirepAddress: UNIREP_ADDRESS,
  provider,
  db,
  attesterId: BigInt(ATTESTER_ID),
})
await synchronizer.start()
await synchronizer.waitForSync()
synchronizer.stop()

const latestSyncedByAttesterId = {}

for (;;) {
  await new Promise((r) => setTimeout(r, 1000))
  try {
    await synchronizer.poll()
  } catch (err) {
    console.warn('---- Synchronizer poll failed ----')
    console.warn(err)
    console.warn('---- ----')
    continue
  }
  await sync()
}

async function sync() {
  const attesters = await synchronizer._db.findMany('Attester', {
    where:
      synchronizer.attesterId === BigInt(0)
        ? {}
        : {
            _id: synchronizer.attesterId.toString(),
          },
  })
  for (const attester of attesters) {
    await syncAttester(attester)
  }
}

async function syncAttester(attester) {
  const { _id, startTimestamp, epochLength } = attester
  const now = Math.floor(+new Date() / 1000)
  const currentEpoch = Math.max(
    0,
    Math.floor(now - startTimestamp) / epochLength
  )
  for (let x = latestSyncedByAttesterId[_id] ?? 0; x < currentEpoch; x++) {
    const isSealed = await synchronizer.unirepContract.attesterEpochSealed(
      _id,
      x
    )
    if (!isSealed) {
      // seal it
      await buildAndSubmit(x, attester._id)
      latestSyncedByAttesterId[_id] = x
    } else {
      latestSyncedByAttesterId[_id] = x
    }
  }
}

async function buildAndSubmit(epoch, attesterId) {
  const leafPreimages = await synchronizer.genEpochTreePreimages(
    epoch,
    attesterId
  )
  const { circuitInputs } = await BuildOrderedTree.buildInputsForLeaves(
    leafPreimages
  )
  const r = await prover.genProofAndPublicSignals(
    Circuit.buildOrderedTree,
    stringifyBigInts(circuitInputs)
  )
  const { publicSignals, proof } = new BuildOrderedTree(
    r.publicSignals,
    r.proof
  )
  const calldata = synchronizer.unirepContract.interface.encodeFunctionData(
    'sealEpoch',
    [epoch, attesterId, publicSignals, proof]
  )
  const hash = await TransactionManager.queueTransaction(
    synchronizer.unirepContract.address,
    calldata
  )
  await synchronizer.provider.waitForTransaction(hash)
}
