const {TransactionBuilder, Networks, xdr} = require('stellar-sdk')
const {processFeeChargedEffect, analyzeOperationEffects} = require('./tx-effects-analyzer')
const {parseTxResult} = require('./tx-result-parser')
const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')
const {parseTxMetaChanges} = require('./tx-meta-changes-parser')

/**
 * Retrieve effects from transaction execution result metadata
 * @param {String} network - Network identifier or passphrase
 * @param {String} tx - Base64-encoded tx envelope xdr
 * @param {String} result? - Base64-encoded tx envelope result
 * @param {String} meta? - Base64-encoded tx envelope meta
 * @return {ParsedTxOperationsMetadata}
 */
function parseTxOperationsMeta({network, tx, result, meta}) {
    const isEphemeral = !meta
    let parsedTx = tx = TransactionBuilder.fromXDR(tx, Networks[network.toUpperCase()] || network)
    let rawResult = xdr.TransactionResult.fromXDR(result, 'base64')
    const rawMeta = xdr.TransactionMeta.fromXDR(meta, 'base64')

    const txEffects = []
    const isFeeBump = !!parsedTx.innerTransaction
    let feeBumpSuccess
    if (isFeeBump) {
        txEffects.push(processFeeChargedEffect(parsedTx, rawResult.feeCharged().toString(), true))
        parsedTx = parsedTx.innerTransaction
        rawResult = rawResult.result().innerResultPair().result()
        feeBumpSuccess = rawResult.result().switch().value >= 0
    }
    txEffects.push(processFeeChargedEffect(parsedTx, rawResult.feeCharged().toString()))

    const res = {
        tx,
        operations: parsedTx.operations,
        effects: txEffects,
        isEphemeral
    }

    if (isEphemeral)
        return res

    const opMeta = rawMeta.value().operations()
    const {success, opResults} = parseTxResult(rawResult)
    if (!success || isFeeBump && !feeBumpSuccess) {
        res.failed = true
        return res
    }

    for (let i = 0; i < parsedTx.operations.length; i++) {
        const operation = parsedTx.operations[i]
        if (!operation.source) {
            operation.source = parsedTx.source
        }
        if (success) {
            analyzeOperationEffects({
                operation,
                meta: opMeta[i]?.changes(),
                result: opResults[i]
            })
        } else {
            operation.effects = []
        }
    }

    return res
}

/**
 * @typedef {{}} ParsedTxOperationsMetadata
 * @property {Transaction|FeeBumpTransaction} tx
 * @property {BaseOperation[]} operations
 * @property {{}[]} effects
 * @property {Boolean} isEphemeral
 * @property {Boolean} failed?
 */

module.exports = {parseTxOperationsMeta, parseTxResult, analyzeOperationEffects, parseLedgerEntryChanges, parseTxMetaChanges}