const {TransactionBuilder, xdr} = require('@stellar/stellar-base')
const {TxMetaEffectParserError, UnexpectedTxMetaChangeError} = require('./errors')
const {processFeeChargedEffect, analyzeOperationEffects, EffectsAnalyzer} = require('./effects-analyzer')
const {disposeSacCache} = require('./aggregation/sac-contract-mapper')
const {parseTxResult} = require('./parser/tx-result-parser')
const {parseLedgerEntryChanges} = require('./parser/ledger-entry-changes-parser')
const {parseTxMetaChanges} = require('./parser/tx-meta-changes-parser')
const {analyzeSignerChanges} = require('./aggregation/signer-changes-analyzer')
const contractPreimageEncoder = require('./parser/contract-preimage-encoder')
const xdrParserUtils = require('./parser/tx-xdr-parser-utils')
const effectTypes = require('./effect-types')

/**
 * Retrieve effects from transaction execution result metadata
 * @param {String} network - Network passphrase
 * @param {String|Buffer|xdr.TransactionEnvelope} tx - Base64-encoded tx envelope xdr
 * @param {String|Buffer|xdr.TransactionResult} [result] - Base64-encoded tx envelope result
 * @param {String|Buffer|xdr.TransactionMeta} [meta] - Base64-encoded tx envelope meta
 * @param {Boolean} [mapSac] - Whether to create a map SAC->Asset
 * @param {Boolean} [processSystemEvents] - Emit effects for contract errors and resource stats
 * @param {Boolean} [processFailedOpEffects] - Whether to generate operation effects for failed/rejected transactions
 * @param {Boolean} [processMetrics] - Process invocation metrics emitted by Soroban
 * @param {Number} [protocol] - Specific Stellar protocol version for the executed transaction
 * @return {ParsedTxOperationsMetadata}
 */
function parseTxOperationsMeta({
                                   network,
                                   tx,
                                   result,
                                   meta,
                                   mapSac = false,
                                   processSystemEvents = false,
                                   processFailedOpEffects = false,
                                   processMetrics,
                                   protocol
                               }) {
    if (!network)
        throw new TypeError(`Network passphrase argument is required.`)
    if (typeof network !== 'string')
        throw new TypeError(`Invalid network passphrase: "${network}".`)
    if (!tx)
        throw new TypeError(`Transaction envelope argument is required.`)
    if (processMetrics !== false)
        processMetrics = true
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
        if (!processFailedOpEffects)
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
        if (isFeeBump && protocol === 20 && before.balance !== after.balance) { //bump fee calculation bug in protocol v20
            const currentFee = BigInt(feeEffect.charged)
            const diff = BigInt(after.balance) - BigInt(before.balance)
            if (diff < currentFee) { // do not allow negative fee
                feeEffect.charged = (currentFee - diff).toString()
            }
        }
    }
    const metaValue = meta.value()
    const opMeta = metaValue.operations()
    const isV4Meta = meta.arm() === 'v4'

    //analyze operation effects for each operation
    for (let i = 0; i < parsedTx.operations.length; i++) {
        const operation = parsedTx.operations[i]
        if (success || processFailedOpEffects) {
            const params = {
                network,
                operation,
                meta: opMeta[i]?.changes() || [],
                result: opResults[i],
                processFailedOpEffects,
                processMetrics
            }
            const isSorobanInvocation = operation.type === 'invokeHostFunction'
            //only for Soroban contract invocation
            if (isSorobanInvocation) {
                const {sorobanMeta} = metaValue._attributes
                if (sorobanMeta) {
                    if (sorobanMeta.events) {
                        params.events = sorobanMeta.events()
                    }
                    if (sorobanMeta.diagnosticEvents) {
                        params.diagnosticEvents = sorobanMeta.diagnosticEvents()
                    }
                    params.processSystemEvents = processSystemEvents
                }
                if (isV4Meta) {
                    params.diagnosticEvents = metaValue.diagnosticEvents()
                    const invocationOp = metaValue.operations()[0]
                    if (invocationOp) {
                        params.events = invocationOp.events()
                    }
                }
                params.mapSac = mapSac
            }
            const analyzer = new EffectsAnalyzer(params)
            operation.effects = analyzer.analyze()
            if (analyzer.sacMap && !isEmptyObject(analyzer.sacMap)) {
                operation.sacMap = analyzer.sacMap
            }
            if (isSorobanInvocation) {
                analyzer.addFeeMetric(metaValue)
            }
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

function isEmptyObject(obj) {
    for (const key in obj)
        return false
    return true
}

/**
 * @typedef {{}} ParsedTxOperationsMetadata
 * @property {Transaction|FeeBumpTransaction} tx - Parsed transaction object
 * @property {BaseOperation[]} operations - Transaction operations
 * @property {Boolean} isEphemeral - True for transactions without result metadata
 * @property {Boolean} [failed] - True for transactions failed during on-chain execution
 * @property {{}[]} [effects] - Top-level transaction effects (fee charges and )
 * @property {Object<String,String>} [sacMap] - Optional map of SAC->Asset
 */

module.exports = {
    parseTxOperationsMeta,
    parseTxResult,
    analyzeOperationEffects,
    parseLedgerEntryChanges,
    parseTxMetaChanges,
    effectTypes,
    xdrParserUtils,
    contractPreimageEncoder,
    disposeSacCache
}