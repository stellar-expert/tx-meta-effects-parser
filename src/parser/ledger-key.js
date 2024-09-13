const {xdr, hash} = require('@stellar/stellar-base')

function generateContractStateEntryHash(data) {
    const {contract, durability, key} = data._attributes
    const contractDataKey = new xdr.LedgerKeyContractData({contract, durability, key})
    const ledgerKey = xdr.LedgerKey.contractData(contractDataKey)
    return hash(ledgerKey.toXDR()).toString('hex')
}

function generateContractCodeEntryHash(wasmHash) {
    const contractDataKey = new xdr.LedgerKeyContractCode({hash: wasmHash})
    const ledgerKey = xdr.LedgerKey.contractCode(contractDataKey)
    return hash(ledgerKey.toXDR()).toString('hex')
}

module.exports = {
    generateContractStateEntryHash,
    generateContractCodeEntryHash
}