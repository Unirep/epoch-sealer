import { Synchronizer, schema } from '@unirep/core'
import { Circuit, BuildOrderedTree } from '@unirep/circuits'
import { stringifyBigInts } from '@unirep/utils'
import { SQLiteConnector } from 'anondb/node.js'
import { ethers } from 'ethers'
import TransactionManager from './TransactionManager.mjs'
import prover from './prover.mjs'

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception!')
  console.error(err)
  process.exit(1)
})

const { UNIREP_ADDRESS, ETH_PROVIDER_URL, ATTESTER_ADDRESS, PRIVATE_KEY  } =
  Object.assign(process.env, {
    ATTESTER_ADDRESS: 0,
  })
const provider = ETH_PROVIDER_URL.startsWith('http')
  ? new ethers.providers.JsonRpcProvider(ETH_PROVIDER_URL)
  : new ethers.providers.WebSocketProvider(ETH_PROVIDER_URL)

TransactionManager.configure(PRIVATE_KEY, provider)
await TransactionManager.start()

const db = await SQLiteConnector.create(schema, ':memory:')

const synchronizer = new Synchronizer({
  prover: {}, // TODO: remove this from the synchronizer
  unirepAddress: UNIREP_ADDRESS,
  provider,
  db,
  attesterId: BigInt(ATTESTER_ADDRESS),
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
  if (synchronizer.provider.network.chainId === 31337) {
    // hardhat dev nodes need to have their state refreshed manually
    // for view only functions
    await synchronizer.provider.send('evm_mine', [])
  }
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
    Math.floor((now - startTimestamp) / +epochLength)
  )
  for (let x = latestSyncedByAttesterId[_id] ?? 0; x < currentEpoch; x++) {
    const attestations = await synchronizer._db.findMany('Attestation', {
      where: {
        attesterId: _id.toString(),
        epoch: x,
      }
    })
    if (attestations.length === 0) {
      latestSyncedByAttesterId[_id] = x
      continue
    }
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
    leafPreimages,
    synchronizer.settings.epochTreeArity,
    synchronizer.settings.epochTreeDepth,
    synchronizer.settings.fieldCount,
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
  try {
    const hash = await TransactionManager.queueTransaction(
      synchronizer.unirepContract.address,
      calldata
    )
    await synchronizer.provider.waitForTransaction(hash)
  } catch (err) {
    console.warn('Error queueing transaction')
    console.warn(err)
  }
}
