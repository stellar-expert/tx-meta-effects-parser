const {StrKey, encodeMuxedAccount, encodeMuxedAccountToAddress} = require('@stellar/stellar-base')
const effectTypes = require('../effect-types')
const {xdrParseScVal, xdrParseAsset, isContractAddress} = require('../parser/tx-xdr-parser-utils')
const {mapSacContract} = require('./sac-contract-mapper')

const EVENT_TYPES = {
    SYSTEM: 0,
    CONTRACT: 1,
    DIAGNOSTIC: 2
}

class EventsAnalyzer {
    /**
     * @param {EffectsAnalyzer} effectsAnalyzer
     */
    constructor(effectsAnalyzer) {
        this.effectsAnalyzer = effectsAnalyzer
        this.callStack = []
    }

    /**
     * @type {[]}
     * @private
     */
    callStack

    analyze() {
        this.analyzeDiagnosticEvents()
        this.analyzeEvents()
    }

    /**
     * @private
     */
    analyzeEvents() {
        const {events} = this.effectsAnalyzer
        if (!events)
            return
        //contract-generated events
        for (const evt of events) {
            const body = evt.body().value()
            const rawTopics = body.topics()
            const topics = rawTopics.map(xdrParseScVal)
            if (topics[0] === 'DATA' && topics[1] === 'set')
                continue //skip data entries modifications
            const rawData = body.data()
            //add event to the pipeline
            this.effectsAnalyzer.addEffect({
                type: effectTypes.contractEvent,
                contract: StrKey.encodeContract(evt.contractId()),
                topics,
                rawTopics: rawTopics.map(v => v.toXDR('base64')),
                data: processEventBodyValue(rawData),
                rawData: rawData.toXDR('base64')
            })
        }
    }


    /**
     * @private
     */
    analyzeDiagnosticEvents() {
        const {diagnosticEvents, processSystemEvents, processMetrics, processFailedOpEffects} = this.effectsAnalyzer
        if (!diagnosticEvents)
            return
        const opContractId = this.effectsAnalyzer.retrieveOpContractId()
        //diagnostic events
        for (const evt of diagnosticEvents) {
            if (!processSystemEvents && !(processFailedOpEffects || evt.inSuccessfulContractCall()))
                continue //throw new UnexpectedTxMetaChangeError({type: 'diagnostic_event', action: 'failed'})
            //parse event
            const event = evt.event()
            let contractId = event.contractId() || opContractId //contract id may be attached to the event itself, otherwise use contract from operation
            if (contractId && typeof contractId !== 'string') {
                contractId = StrKey.encodeContract(contractId)
            }
            this.processDiagnosticEvent(event._attributes.body._value, event._attributes.type.value, contractId, processMetrics)
        }
    }

    /**
     * @param {xdr.ContractEventV0} body
     * @param {Number} type
     * @param {String} contract
     * @param {Boolean} processMetrics
     * @private
     */
    processDiagnosticEvent(body, type, contract, processMetrics) {
        const topics = body.topics()
        if (!topics?.length)
            return
        switch (xdrParseScVal(topics[0])) {
            case 'fn_call': // contract call
                if (type !== EVENT_TYPES.DIAGNOSTIC)
                    return // skip non-diagnostic events
                const rawArgs = body.data()
                const funcCall = {
                    type: effectTypes.contractInvoked,
                    contract: xdrParseScVal(topics[1], true),
                    function: xdrParseScVal(topics[2]),
                    args: processEventBodyValue(rawArgs),
                    rawArgs: rawArgs.toXDR('base64')
                }
                //add the invocation to the call stack
                if (this.callStack.length) {
                    funcCall.depth = this.callStack.length
                }
                this.callStack.push(funcCall)
                this.effectsAnalyzer.addEffect(funcCall)
                break
            case 'fn_return':
                if (type !== EVENT_TYPES.DIAGNOSTIC)
                    return // skip non-diagnostic events
                //attach execution result to the contract invocation event
                const lastFuncCall = this.callStack.pop()
                const result = body.data()
                if (result.switch().name !== 'scvVoid') {
                    lastFuncCall.result = result.toXDR('base64')
                }
                break
            case 'error':
                if (type !== EVENT_TYPES.DIAGNOSTIC)
                    return // skip non-diagnostic events
                let code = topics[1].value().value()
                if (code.name) {
                    code = code.name
                }
                this.effectsAnalyzer.addEffect({
                    type: effectTypes.contractError,
                    contract,
                    code,
                    details: processEventBodyValue(body.data())
                })
                break
            case 'core_metrics':
                if (type !== EVENT_TYPES.DIAGNOSTIC)
                    return // skip non-diagnostic events
                if (!processMetrics)
                    return
                this.effectsAnalyzer.addMetric(contract, xdrParseScVal(topics[1]), parseInt(processEventBodyValue(body.data())))
                break
            //handle standard token contract events
            //see https://github.com/stellar/rs-soroban-sdk/blob/main/soroban-sdk/src/token.rs
            case 'transfer': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    return
                const from = xdrParseScVal(topics[1])
                const receiver = xdrParseScVal(topics[2])
                let to = receiver
                let amount = processEventBodyValue(body.data())
                if (amount?.amount !== undefined) {
                    if (amount.to_muxed_id && !to.startsWith('M')) {
                        to = encodeMuxedAccountToAddress(encodeMuxedAccount(to, amount.to_muxed_id))
                        amount = amount.amount
                    }
                }
                if (typeof amount !== 'string')
                    return null
                if (to === from) //self transfer - nothing happens
                    return // TODO: need additional checks
                const asset = this.getAssetFromEventTopics(topics, contract)
                if (!StrKey.isValidContract(asset)) {
                    if (asset.includes(from)) {  //SAC transfer by asset issuer
                        this.effectsAnalyzer.mint(asset, amount)
                    }
                    if (isContractAddress(from)) {
                        this.effectsAnalyzer.debit(amount, asset, from)
                    }
                    if (isContractAddress(to)) {
                        this.effectsAnalyzer.credit(amount, asset, to)
                    }
                    if (asset.includes(receiver)) {  //SAC transfer by asset issuer
                        this.effectsAnalyzer.burn(asset, amount)
                    }
                } else { //other cases
                    this.effectsAnalyzer.debit(amount, asset, from)
                    this.effectsAnalyzer.credit(amount, asset, to)
                }
            }
                break
            case 'mint': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']) && !matchEventTopicsShape(topics, ['address', 'str?']))
                    return //throw new Error('Non-standard event')
                let to = xdrParseScVal(topics[topics[2]?._arm === 'address' ? 2 : 1])
                let amount = processEventBodyValue(body.data())
                if (amount?.amount !== undefined) {
                    if (amount.to_muxed_id && !to.startsWith('M')) {
                        to = encodeMuxedAccountToAddress(encodeMuxedAccount(to, amount.to_muxed_id))
                        amount = amount.amount
                    }
                }
                if (typeof amount !== 'string')
                    return null
                const asset = this.getAssetFromEventTopics(topics, contract)
                this.effectsAnalyzer.mint(asset, amount)
                if (isContractAddress(asset) || isContractAddress(to)) {
                    this.effectsAnalyzer.credit(amount, asset, to)
                }
            }
                break
            case 'burn': {
                if (!matchEventTopicsShape(topics, ['address', 'str?']))
                    return //throw new Error('Non-standard event')
                const from = xdrParseScVal(topics[1])
                const amount = processEventBodyValue(body.data())
                if (typeof amount !== 'string')
                    return null
                const asset = this.getAssetFromEventTopics(topics, contract)
                if (isContractAddress(asset) || isContractAddress(from)) {
                    this.effectsAnalyzer.debit(amount, asset, from)
                }
                this.effectsAnalyzer.burn(asset, amount)
            }
                break
            case 'clawback': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']) && !matchEventTopicsShape(topics, ['address', 'str?']))
                    return //throw new Error('Non-standard event')
                const from = xdrParseScVal(topics[topics[2]?._arm === 'address' ? 2 : 1])
                const amount = processEventBodyValue(body.data())
                if (typeof amount !== 'string')
                    return null
                const asset = this.getAssetFromEventTopics(topics, contract)
                if (StrKey.isValidContract(from)) { //transfer tokens from account only in case of contract assets to avoid double debits
                    this.effectsAnalyzer.debit(amount, asset, from)
                    this.effectsAnalyzer.burn(asset, amount)
                }
            }
                break
            case 'set_admin': {
                if (!matchEventTopicsShape(topics, ['address', 'str?']))
                    return //throw new Error('Non-standard event')
                const currentAdmin = xdrParseScVal(topics[1])
                const newAdmin = processEventBodyValue(body.data())
                this.getAssetFromEventTopics(topics, contract)
                this.effectsAnalyzer.setAdmin(contract, newAdmin)
            }
                break
            case 'set_authorized': {
                if (!matchEventTopicsShape(topics, ['address', 'str?']))
                    return //throw new Error('Non-standard event')
                const trustor = xdrParseScVal(topics[1])
                const asset = this.getAssetFromEventTopics(topics, contract)
                const isAuthorized = processEventBodyValue(body.data())
                this.effectsAnalyzer.addEffect({
                    type: effectTypes.trustlineAuthorizationUpdated,
                    trustor,
                    asset,
                    flags: isAuthorized ? 1 : 0,
                    prevFlags: isAuthorized ? 0 : 1
                })
            }
                break
            //TODO: think about processing these effects
            /*case 'approve': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    throw new Error('Non-standard event')
                const from = xdrParseScVal(topics[1])
                const spender = xdrParseScVal(topics[2])
                if (topics.length > 3) {
                    mapSacContract(this.effectsAnalyzer, contractId, xdrParseAsset(xdrParseScVal(topics[3])))
                }
            }
                break*/
        }
    }

    /**
     * @param {ScVal[]} topics
     * @param {string} contract
     * @return {string|null}
     * @private
     */
    getAssetFromEventTopics(topics, contract) {
        const last = topics[topics.length - 1]
        if (last._arm === 'str') {
            const classicAsset = xdrParseAsset(xdrParseScVal(last))
            mapSacContract(this.effectsAnalyzer, contract, classicAsset)
        }
        return this.effectsAnalyzer.resolveAsset(contract)
    }
}

/**
 * Compare types in the topics array with expected values
 * @param {ScVal[]} topics
 * @param {string[]} shape
 * @return {boolean}
 */
function matchEventTopicsShape(topics, shape) {
    if (topics.length > shape.length + 1)
        return false
    //we ignore the first topic because it's an event name
    for (let i = 0; i < shape.length; i++) {
        let match = shape[i]
        let optional = false
        if (match.endsWith('?')) {
            match = match.substring(0, match.length - 1)
            optional = true
        }
        const topic = topics[i + 1]
        if (topic) {
            if (topic._arm !== match)
                return false
        } else if (!optional)
            return false
    }
    return true
}

/**
 * Retrieve event body value
 * @param value
 */
function processEventBodyValue(value) {
    const innerValue = value.value()
    if (innerValue === undefined) //scVoid
        return null
    return xdrParseScVal(value) //other scValue
}

module.exports = EventsAnalyzer