import fs from 'fs/promises'
import path from 'path'
import url from 'url'
import os from 'os'
import { exec } from 'child_process'
import * as snarkjs from 'snarkjs'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const keyPath = path.join(__dirname, '../keys')

/**
 * Executes a shell command and return it as a Promise.
 * @param cmd {string} - the bash command to run in the child process
 * @return {Promise<string>} - output or result of the command
 */
function cmd(cmd) {
  const child = exec(cmd)
  return new Promise((resolve, reject) => {
    child.addListener('error', reject)
    child.addListener('close', (exitcode) => {
      if (exitcode === 0) resolve()
      else reject(`rapidsnark sent bad exit code ${exitcode}`)
    })
  })
}

export default {
  genProofAndPublicSignals: async (circuitName, inputs) => {
    // generate a new temporary folder for proving artifacts
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'sealer-'))
    // define proving artifact filepaths
    const circuitWasmPath = path.join(keyPath, `${circuitName}.wasm`)
    const zkeyPath = path.join(keyPath, `${circuitName}.zkey`)
    // working paths
    const witnessPath = path.join(folder, `${circuitName}.witness`)
    const proofPath = path.join(folder, `${circuitName}-proof.json`)
    const publicSignalsPath = path.join(folder, `${circuitName}-signals.json`)
    // calculate witness and write to fs
    await snarkjs.wtns.calculate(inputs, circuitWasmPath, witnessPath)
    // spawn child_process to build proof and public signals using rapidsnark
    const start = +new Date()
    await cmd(
      `rapidsnark ${zkeyPath} ${witnessPath} ${proofPath} ${publicSignalsPath}`
    )
    console.log(`Built proof in ${+new Date() - start}ms`)
    // load proof and public signals from fs
    const loadJson = async (p) =>
      JSON.parse((await fs.readFile(p)).toString())
    const r = {
      proof: await loadJson(proofPath),
      publicSignals: await loadJson(publicSignalsPath),
    }
    // delete temporary artifacts from fs
    await fs.rm(folder, { recursive: true })
    return r
  },

  verifyProof: async (circuitName, publicSignals, proof) => {
    throw new Error('Not implemented')
  },

  getVKey: (name) => {
    return require(path.join(keyPath, `${name}.vkey.json`))
  },
}
