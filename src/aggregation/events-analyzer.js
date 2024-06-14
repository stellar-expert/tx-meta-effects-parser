const {StrKey} = require('@stellar/stellar-base')
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
        const {diagnosticEvents, processSystemEvents} = this.effectsAnalyzer
        if (!diagnosticEvents)
            return
        //diagnostic events
        for (const evt of diagnosticEvents) {
            if (!processSystemEvents && !evt.inSuccessfulContractCall())
                continue //throw new UnexpectedTxMetaChangeError({type: 'diagnostic_event', action: 'failed'})
            //parse event
            const event = evt.event()
            const contractId = event.contractId() //contract id attached to the event itself
                || this.effectsAnalyzer.operation.func._value.contractAddress()._value //retrieve from the operation
            this.processDiagnosticEvent(event.body().value(), event.type().value, contractId ? StrKey.encodeContract(contractId) : null)
        }
    }

    /**
     * @param {xdr.ContractEventV0} body
     * @param {Number} type
     * @param {String} contract
     * @private
     */
    processDiagnosticEvent(body, type, contract) {
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
                this.effectsAnalyzer.addEffect({
                    type: effectTypes.contractError,
                    contract,
                    code: topics[1].value().value(),
                    details: processEventBodyValue(body.data())
                })
                break
            case 'core_metrics':
                if (type !== EVENT_TYPES.DIAGNOSTIC)
                    return // skip non-diagnostic events
                this.effectsAnalyzer.addMetric(contract, xdrParseScVal(topics[1]), parseInt(processEventBodyValue(body.data())))
                break
            //handle standard token contract events
            //see https://github.com/stellar/rs-soroban-sdk/blob/main/soroban-sdk/src/token.rs
            case 'transfer': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    return
                const from = xdrParseScVal(topics[1])
                const to = xdrParseScVal(topics[2])
                if (to === from) //self transfer - nothing happens
                    return // TODO: need additional checks
                const amount = processEventBodyValue(body.data())
                if (!this.matchInvocationEffect(e =>
                    (e.function === 'transfer' && matchArrays([from, to, amount], e.args)) ||
                    (e.function === 'transfer_from' && matchArrays([undefined, from, to, amount], e.args))
                ))
                    return
                let classicAsset
                if (topics.length > 3) {
                    classicAsset = xdrParseAsset(xdrParseScVal(topics[3]))
                    if (!mapSacContract(this.effectsAnalyzer, contract, classicAsset)) {
                        classicAsset = null  //not an SAC event
                    }
                }
                if (classicAsset && (classicAsset.includes(from) || classicAsset.includes(to))) { //SAC transfer by asset issuer
                    if (classicAsset.includes(from)) {
                        this.effectsAnalyzer.mint(contract, amount)
                        this.effectsAnalyzer.credit(amount, isContractAddress(to) ? contract : classicAsset, to)
                    }
                    if (classicAsset.includes(to)) {
                        this.effectsAnalyzer.debit(amount, isContractAddress(from) ? contract : classicAsset, from)
                        this.effectsAnalyzer.burn(contract, amount)
                    }
                } else { //other cases
                    if (classicAsset && !isContractAddress(from)) { //classic asset bridged to Soroban
                        this.effectsAnalyzer.burn(classicAsset, amount)
                        this.effectsAnalyzer.mint(contract, amount)
                    } else {
                        this.effectsAnalyzer.debit(amount, contract, from)
                    }
                    if (classicAsset && !isContractAddress(to)) { //classic asset bridged from Soroban
                        this.effectsAnalyzer.burn(contract, amount)
                        this.effectsAnalyzer.mint(classicAsset, amount)
                    } else {
                        this.effectsAnalyzer.credit(amount, contract, to)
                    }
                }

            }
                break
            case 'mint': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    return //throw new Error('Non-standard event')
                const to = xdrParseScVal(topics[2])
                const amount = processEventBodyValue(body.data())
                if (!this.matchInvocationEffect(e => e.function === 'mint' && matchArrays([to, amount], e.args)))
                    return
                this.effectsAnalyzer.addEffect({
                    type: effectTypes.assetMinted,
                    asset: contract,
                    amount
                })
                this.effectsAnalyzer.credit(amount, contract, to)
                if (topics.length > 3) {
                    mapSacContract(this.effectsAnalyzer, contract, xdrParseAsset(xdrParseScVal(topics[3])))
                }
            }
                break
            case 'burn': {
                if (!matchEventTopicsShape(topics, ['address', 'str?']))
                    return //throw new Error('Non-standard event')
                const from = xdrParseScVal(topics[1])
                const amount = processEventBodyValue(body.data())
                if (!this.matchInvocationEffect(e =>
                    (e.function === 'burn' && matchArrays([from, amount], e.args)) ||
                    (e.function === 'burn_from' && matchArrays([undefined, from, amount], e.args))
                ))
                    return

                this.effectsAnalyzer.debit(amount, contract, from)
                this.effectsAnalyzer.burn(contract, amount)
                if (topics.length > 2) {
                    mapSacContract(this.effectsAnalyzer, contract, xdrParseAsset(xdrParseScVal(topics[2])))
                }
            }
                break
            case 'clawback': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    return //throw new Error('Non-standard event')
                const from = xdrParseScVal(topics[2])
                const amount = processEventBodyValue(body.data())
                if (!this.matchInvocationEffect(e => e.function === 'clawback' && matchArrays([from, amount], e.args)))
                    return
                this.effectsAnalyzer.debit(amount, contract, from)
                this.effectsAnalyzer.burn(contract, amount)
                if (topics.length > 3) {
                    mapSacContract(this.effectsAnalyzer, contract, xdrParseAsset(xdrParseScVal(topics[3])))
                }
            }
                break
            case 'set_admin': {
                if (!matchEventTopicsShape(topics, ['address', 'str?']))
                    return //throw new Error('Non-standard event')
                const currentAdmin = xdrParseScVal(topics[1])
                const newAdmin = processEventBodyValue(body.data())
                if (!this.matchInvocationEffect(e => e.function === 'set_admin' && matchArrays([currentAdmin, newAdmin], [this.effectsAnalyzer.source, e.args])))
                    return
                this.effectsAnalyzer.setAdmin(contract, newAdmin)
                if (topics.length > 2) {
                    mapSacContract(this.effectsAnalyzer, contract, xdrParseAsset(xdrParseScVal(topics[2])))
                }
            }
                break
            /*case 'approve': { //TODO: think about processing this effect
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

    matchInvocationEffect(cb) {
        return this.effectsAnalyzer.effects.find(e => e.type === effectTypes.contractInvoked && cb(e))
    }
}

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

function matchArrays(a, b) {
    if (!a || !b)
        return false
    if (a.length !== b.length)
        return false
    for (let i = a.length; i--;) {
        if (a[i] !== undefined && a[i] !== b[i]) //undefined serves as * substitution
            return false
    }
    return true
}

function processEventBodyValue(value) {
    const innerValue = value.value()
    /*if (innerValue instanceof Array) //handle simple JS arrays
        return innerValue.map(xdrParseScVal)*/
    if (!innerValue) //scVoid
        return undefined
    return xdrParseScVal(value) //other scValue
}

module.exports = EventsAnalyzer