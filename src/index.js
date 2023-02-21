const {TransactionBuilder, Networks, xdr} = require('stellar-sdk')
const {processFeeChargedEffect, analyzeOperationEffects} = require('./tx-effects-analyzer')
const {parseTxResult} = require('./tx-result-parser')
const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')
const {parseTxMetaChanges} = require('./tx-meta-changes-parser')

/**
 * Retrieve effects from transaction execution result metadata
 * @param {String} network - Network identifier or passphrase
 * @param {String|Buffer|xdr.TransactionEnvelope} tx - Base64-encoded tx envelope xdr
 * @param {String|Buffer|xdr.TransactionResult} result? - Base64-encoded tx envelope result
 * @param {String|Buffer|xdr.TransactionMeta} meta? - Base64-encoded tx envelope meta
 * @return {ParsedTxOperationsMetadata}
 */
function parseTxOperationsMeta({network, tx, result, meta}) {
    if (!network)
        throw new TypeError(`Network passphrase/identifier argument is required.`)
    if (typeof network !== 'string')
        throw new TypeError(`Invalid network passphrase or identifier: "${network}".`)
    if (!tx)
        throw new TypeError(`Transaction envelope argument is required.`)
    const isEphemeral = !meta
    //parse tx, result, and meta xdr
    tx = ensureXdrInputType(tx, xdr.TransactionEnvelope)
    result = ensureXdrInputType(result, xdr.TransactionResult)

    let parsedTx = tx = TransactionBuilder.fromXDR(tx, Networks[network.toUpperCase()] || network)

    const txEffects = []
    const isFeeBump = !!parsedTx.innerTransaction
    let feeBumpSuccess

    //take inner transaction if parsed tx is a fee bump tx
    if (isFeeBump) {
        parsedTx = parsedTx.innerTransaction
        if (!isEphemeral) { //add fee bump charge effect
            txEffects.push(processFeeChargedEffect(parsedTx, result.feeCharged().toString(), true))
        }
        result = result.result().innerResultPair().result()
        feeBumpSuccess = result.result().switch().value >= 0
    }

    const res = {
        tx,
        operations: parsedTx.operations,
        effects: txEffects,
        isEphemeral
    }

    //normalize operation source and effects container
    for (const op of parsedTx.operations) {
        if (!op.source) {
            op.source = parsedTx.source
        }
        op.effects = []
    }

    //add fee charge effect
    txEffects.push(processFeeChargedEffect(parsedTx, result.feeCharged().toString()))
    const {success, opResults} = parseTxResult(result)
    if (!success || isFeeBump && !feeBumpSuccess) {
        res.failed = true
        return res
    }

    //do not parse meta for unsubmitted/rejected transactions
    if (isEphemeral)
        return res

    //retrieve operations result metadata
    meta = ensureXdrInputType(meta, xdr.TransactionMeta)
    const opMeta = meta.value().operations()

    //analyze operation effects for each operation
    for (let i = 0; i < parsedTx.operations.length; i++) {
        const operation = parsedTx.operations[i]
        if (success) {
            analyzeOperationEffects({
                operation,
                meta: opMeta[i]?.changes(),
                result: opResults[i]
            })
        }
    }
    return res
}

function ensureXdrInputType(value, xdrType) {
    if (value) {
        if (!(value instanceof xdrType))
            return xdrType.fromXDR(value, typeof value === 'string' ? 'base64' : 'raw')
        if (!(value instanceof xdrType))
            throw new TypeError(`Invalid input format. Expected xdr.${xdrType.name} (raw, buffer, or bas64-encoded).`)
    }
    return value
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