const {xdr, hash} = require('@stellar/stellar-sdk')
const {xdrParseHex} = require('./tx-xdr-parser-utils')

function generateContractStateEntryHash(data) {
    const {contract, durability, key} = data
    const contractDataKey = new xdr.LedgerKeyContractData({contract, durability, key})
    const ledgerKey = xdr.LedgerKey.contractData(contractDataKey)
    return xdrParseHex(hash(ledgerKey.toXdr()))
}

function generateContractCodeEntryHash(wasmHash) {
    //the key accepts a wrapped Hash value, while callers may provide raw bytes
    const contractDataKey = new xdr.LedgerKeyContractCode({hash: wasmHash instanceof Uint8Array ? new xdr.Hash(wasmHash) : wasmHash})
    const ledgerKey = xdr.LedgerKey.contractCode(contractDataKey)
    return xdrParseHex(hash(ledgerKey.toXdr()))
}

module.exports = {
    generateContractStateEntryHash,
    generateContractCodeEntryHash
}
