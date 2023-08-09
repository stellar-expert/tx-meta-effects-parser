const {TransactionBuilder, Networks, xdr} = require('stellar-base')
const {processFeeChargedEffect, analyzeOperationEffects} = require('./tx-effects-analyzer')
const {parseTxResult} = require('./tx-result-parser')
const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')
const {parseTxMetaChanges} = require('./tx-meta-changes-parser')
const effectTypes = require('./effect-types')
const {TxMetaEffectParserError, UnexpectedTxMetaChangeError} = require('./errors')
const {analyzeSignerChanges} = require('./signer-changes-analyzer')

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
    try {
        result = ensureXdrInputType(result, xdr.TransactionResult)
    } catch (e) {
        try {
            const pair = ensureXdrInputType(result, xdr.TransactionResultPair)
            result = pair.result()
        } catch {
            throw new TxMetaEffectParserError('Invalid transaction result XDR. ' + e.message)
        }
    }

    tx = TransactionBuilder.fromXDR(tx, Networks[network.toUpperCase()] || network)

    let parsedTx = tx
    let parsedResult = result

    const isFeeBump = !!parsedTx.innerTransaction
    let feeBumpSuccess

    const res = {
        tx,
        isEphemeral
    }

    //take inner transaction if parsed tx is a fee bump tx
    if (isFeeBump) {
        parsedTx = parsedTx.innerTransaction
        if (parsedTx.innerTransaction)
            throw new TxMetaEffectParserError('Failed to process FeeBumpTransaction wrapped with another FeeBumpTransaction')
        if (!isEphemeral) {
            parsedResult = result.result().innerResultPair().result()
            feeBumpSuccess = parsedResult.result().switch().value >= 0
        }
    }

    //normalize operation source and effects container
    if (parsedTx.operations) {
        res.operations = parsedTx.operations

        for (const op of parsedTx.operations) {
            if (!op.source) {
                op.source = parsedTx.source
            }
            op.effects = []
        }
    }

    //process fee charge
    res.effects = [processFeeChargedEffect(tx, tx.feeSource || parsedTx.source, result.feeCharged().toString(), isFeeBump)]

    //check execution result
    const {success, opResults} = parseTxResult(parsedResult)
    if (!success || isFeeBump && !feeBumpSuccess) {
        res.failed = true
        return res
    }

    //do not parse meta for unsubmitted/rejected transactions
    if (isEphemeral)
        return res

    //retrieve operations result metadata
    try {
        meta = ensureXdrInputType(meta, xdr.TransactionMeta)
    } catch {
        throw new TxMetaEffectParserError('Invalid transaction metadata XDR. ' + e.message)
    }

    //add tx-level effects
    for (const {before, after} of parseTxMetaChanges(meta)) {
        if (before.entry !== 'account')
            throw new UnexpectedTxMetaChangeError({type: before.entry, action: 'update'})
        for (const effect of analyzeSignerChanges(before, after)) {
            effect.source = parsedTx.source
            res.effects.push(effect)
        }
    }

    const opMeta = meta.value().operations()
    //analyze operation effects for each operation
    for (let i = 0; i < parsedTx.operations.length; i++) {
        const operation = parsedTx.operations[i]
        if (success) {
            operation.effects = analyzeOperationEffects({
                operation,
                meta: opMeta[i]?.changes(),
                result: opResults[i]
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
    if (value?._attributes)
        return value

    if (!value || (typeof value !== 'string' && !(value instanceof Uint8Array)))
        throw new TypeError(`Invalid input format. Expected xdr.${xdrType.name} (raw, buffer, or bas64-encoded).`)
    return xdrType.fromXDR(value, typeof value === 'string' ? 'base64' : 'raw')
}

/**
 * @typedef {{}} ParsedTxOperationsMetadata
 * @property {Transaction|FeeBumpTransaction} tx
 * @property {BaseOperation[]} operations
 * @property {Boolean} isEphemeral
 * @property {Boolean} [failed]
 * @property {{}[]} [effects]
 */

module.exports = {parseTxOperationsMeta, parseTxResult, analyzeOperationEffects, parseLedgerEntryChanges, parseTxMetaChanges, effectTypes}