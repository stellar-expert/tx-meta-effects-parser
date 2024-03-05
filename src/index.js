const {TransactionBuilder, xdr} = require('@stellar/stellar-base')
const {processFeeChargedEffect, analyzeOperationEffects, EffectsAnalyzer} = require('./tx-effects-analyzer')
const {parseTxResult} = require('./tx-result-parser')
const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')
const {parseTxMetaChanges} = require('./tx-meta-changes-parser')
const {analyzeSignerChanges} = require('./signer-changes-analyzer')
const contractPreimageEncoder = require('./contract-preimage-encoder')
const xdrParserUtils = require('./tx-xdr-parser-utils')
const effectTypes = require('./effect-types')
const {TxMetaEffectParserError, UnexpectedTxMetaChangeError} = require('./errors')

/**
 * Retrieve effects from transaction execution result metadata
 * @param {String} network - Network passphrase
 * @param {String|Buffer|xdr.TransactionEnvelope} tx - Base64-encoded tx envelope xdr
 * @param {String|Buffer|xdr.TransactionResult} result? - Base64-encoded tx envelope result
 * @param {String|Buffer|xdr.TransactionMeta} meta? - Base64-encoded tx envelope meta
 * @return {ParsedTxOperationsMetadata}
 */
function parseTxOperationsMeta({network, tx, result, meta}) {
    if (!network)
        throw new TypeError(`Network passphrase argument is required.`)
    if (typeof network !== 'string')
        throw new TypeError(`Invalid network passphrase or identifier: "${network}".`)
    if (!tx)
        throw new TypeError(`Transaction envelope argument is required.`)
    const isEphemeral = !meta
    //parse tx, result, and meta xdr
    try {
        tx = ensureXdrInputType(tx, xdr.TransactionEnvelope)
    } catch (e) {
        throw new TxMetaEffectParserError('Invalid transaction envelope XDR. ' + e.message)
    }
    if (!isEphemeral) {
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
    }
    tx = TransactionBuilder.fromXDR(tx, network)

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

    res.effects = []

    if (isEphemeral)
        return res //do not parse meta for unsubmitted/rejected transactions

    //process fee charge
    const feeEffect = processFeeChargedEffect(tx, tx.feeSource || parsedTx.source, result.feeCharged().toString(), isFeeBump)
    res.effects.push(feeEffect)

    //check execution result
    const {success, opResults} = parseTxResult(parsedResult)
    if (!success || isFeeBump && !feeBumpSuccess) {
        res.failed = true
        return res
    }

    //retrieve operations result metadata
    try {
        meta = ensureXdrInputType(meta, xdr.TransactionMeta)
    } catch (e) {
        throw new TxMetaEffectParserError('Invalid transaction metadata XDR. ' + e.message)
    }

    //add tx-level effects
    for (const {before, after} of parseTxMetaChanges(meta)) {
        if (before.entry !== 'account')
            throw new UnexpectedTxMetaChangeError({type: before.entry, action: 'update'})
        for (const effect of analyzeSignerChanges(before, after)) {
            effect.source = (before || after).address
            res.effects.push(effect)
        }
        if (isFeeBump && before.balance !== after.balance) { //fee bump fee calculation bug
            const currentFee = BigInt(feeEffect.charged)
            const diff = BigInt(after.balance) - BigInt(before.balance)
            if (diff < currentFee) { // do not allow negative fee
                feeEffect.charged = (currentFee - diff).toString()
            }
        }
    }
    const metaValue = meta.value()
    const opMeta = metaValue.operations()

    //analyze operation effects for each operation
    for (let i = 0; i < parsedTx.operations.length; i++) {
        const operation = parsedTx.operations[i]
        if (success) {
            const params = {
                operation,
                meta: opMeta[i]?.changes(),
                result: opResults[i], network
            }
            //only for Soroban contract invocation
            if (operation.type === 'invokeHostFunction') {
                const sorobanMeta = metaValue.sorobanMeta()
                params.events = sorobanMeta.events()
                params.diagnosticEvents = sorobanMeta.diagnosticEvents()
            }
            const analyzer = new EffectsAnalyzer(params)
            operation.effects = analyzer.analyze()
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
    if (value?.toXDR) // duck-typing check XDR types
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

module.exports = {
    parseTxOperationsMeta,
    parseTxResult,
    analyzeOperationEffects,
    parseLedgerEntryChanges,
    parseTxMetaChanges,
    effectTypes,
    xdrParserUtils,
    contractPreimageEncoder
}