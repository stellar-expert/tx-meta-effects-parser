const {TransactionBuilder, Networks, xdr} = require('stellar-base')
const {processFeeChargedEffect, analyzeOperationEffects} = require('./tx-effects-analyzer')
const {parseTxResult} = require('./tx-result-parser')
const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')
const {parseTxMetaChanges} = require('./tx-meta-changes-parser')
const effectTypes = require('./effect-types')
const {TxMetaEffectParserError} = require('./errors')

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
    try {
        tx = ensureXdrInputType(tx, xdr.TransactionEnvelope)
    } catch (e) {
        throw  new TxMetaEffectParserError('Invalid transaction envelope XDR. ' + e.message)
    }
    let txResult
    if (!isEphemeral) {
        //retrieve operations result metadata
        try {
            meta = ensureXdrInputType(meta, xdr.TransactionMeta)
            if (meta.switch() === 3) {
                txResult = meta.v3().txResult()
            }
        } catch {
            throw new TxMetaEffectParserError('Invalid transaction metadata XDR. ' + e.message)
        }
    }
    //and tx result itself (for pre-Soroban environment it is stored separately)
    if (!txResult) {
        try {
            txResult = ensureXdrInputType(result, xdr.TransactionResult)
        } catch (e) {
            try {
                //try TransactionResultPair instead of TransactionResult
                const pair = ensureXdrInputType(result, xdr.TransactionResultPair)
                txResult = pair.result()
            } catch {
                throw new TxMetaEffectParserError('Invalid transaction result XDR. ' + e.message)
            }
        }
    }

    tx = TransactionBuilder.fromXDR(tx, Networks[network.toUpperCase()] || network)

    let parsedTx = tx

    const isFeeBump = !!parsedTx.innerTransaction
    let feeBumpSuccess
    const res = {
        tx,
        isEphemeral
    }

    if (!isEphemeral) {
        res.fee = processFeeChargedEffect(parsedTx, txResult.feeCharged().toString(), isFeeBump)
    }

    //take inner transaction if parsed tx is a fee bump tx
    if (isFeeBump) {
        parsedTx = parsedTx.innerTransaction
        if (!isEphemeral) {
            txResult = txResult.result().innerResultPair().result()
            feeBumpSuccess = txResult.result().switch().value >= 0
        }
    }
    if (parsedTx.operations) {
        res.operations = parsedTx.operations

        //normalize operation source and effects container
        for (const op of parsedTx.operations) {
            if (!op.source) {
                op.source = parsedTx.source
            }
            op.effects = []
        }
    }

    const {success, opResults} = parseTxResult(txResult)
    if (!success || isFeeBump && !feeBumpSuccess) {
        res.failed = true
        return res
    }

    //do not process meta for unsubmitted/rejected transactions
    if (isEphemeral)
        return res

    const metaValue = meta.value()
    const opMeta = metaValue.operations()
    const events = metaValue.events ? metaValue.events().map(opEvents => opEvents.events()) : []

    //analyze operation effects for each operation
    for (let i = 0; i < parsedTx.operations.length; i++) {
        const operation = parsedTx.operations[i]
        if (success) {
            operation.effects = analyzeOperationEffects({
                operation,
                meta: opMeta[i]?.changes(),
                result: opResults[i],
                events: events[i]
            })
        }
    }
    return res
}

/**
 * Convert base64/raw XDR representation to XDR type
 * @param {String|Buffer|Uint8Array|xdrType} value
 * @param xdrType
 * @return {xdrType|*}
 * @internal
 */
function ensureXdrInputType(value, xdrType) {
    if (value instanceof xdrType)
        return value

    if (!value || (typeof value !== 'string' && !(value instanceof Uint8Array)))
        throw new TypeError(`Invalid input format. Expected xdr.${xdrType.name} (raw, buffer, or bas64-encoded).`)
    return xdrType.fromXDR(value, typeof value === 'string' ? 'base64' : 'raw')
}

/**
 * @typedef {{}} ParsedTxOperationsMetadata
 * @property {Transaction|FeeBumpTransaction} tx
 * @property {BaseOperation[]} operations
 * @property {{}} fee
 * @property {Boolean} isEphemeral
 * @property {Boolean} failed?
 */

module.exports = {parseTxOperationsMeta, parseTxResult, analyzeOperationEffects, parseLedgerEntryChanges, parseTxMetaChanges, effectTypes}