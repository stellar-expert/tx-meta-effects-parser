const {StrKey} = require('@stellar/stellar-base')
const {xdrParseScVal, xdrParseAsset, isContractAddress, toStellarAsset} = require('./tx-xdr-parser-utils')
const {contractIdFromAsset} = require('./contract-preimage-encoder')
const effectTypes = require('./effect-types')

const EVENT_TYPES = {
    SYSTEM: 0,
    CONTRACT: 1,
    DIAGNOSTIC: 2
}

class EventsAnalyzer {
    constructor(effectAnalyzer) {
        this.effectAnalyzer = effectAnalyzer
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
        const {events} = this.effectAnalyzer
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
            this.effectAnalyzer.addEffect({
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
        const {diagnosticEvents} = this.effectAnalyzer
        if (!diagnosticEvents)
            return
        //diagnostic events
        for (const evt of diagnosticEvents) {
            if (!evt.inSuccessfulContractCall())
                return //throw new UnexpectedTxMetaChangeError({type: 'diagnostic_event', action: 'failed'})
            //parse event
            const event = evt.event()
            const contractId = event.contractId()
            this.processDiagnosticEvent(event.body().value(), event.type().value, contractId ? StrKey.encodeContract(contractId) : null)
        }
    }

    /**
     * @param {xdr.ContractEventV0} body
     * @param {Number} type
     * @param {String} contractId
     * @private
     */
    processDiagnosticEvent(body, type, contractId) {
        const topics = body.topics()
        if (!topics?.length)
            return null
        switch (xdrParseScVal(topics[0])) {
            case 'fn_call': // contract call
                const rawArgs = body.data()
                const parsedEvent = {
                    type: effectTypes.contractInvoked,
                    contract: xdrParseScVal(topics[1], true),
                    function: xdrParseScVal(topics[2]),
                    args: processEventBodyValue(rawArgs),
                    rawArgs: rawArgs.toXDR('base64')
                }
                //add the invocation to the call stack
                if (this.callStack.length) {
                    parsedEvent.depth = this.callStack.length
                }
                this.callStack.push(parsedEvent)
                this.effectAnalyzer.addEffect(parsedEvent)
                break
            case 'fn_return':
                if (type !== EVENT_TYPES.DIAGNOSTIC)
                    return // skip non-diagnostic events
                //attach execution result to the contract invocation event
                const funcCall = this.callStack.pop()
                const result = body.data()
                if (result.switch().name !== 'scvVoid') {
                    funcCall.result = result.toXDR('base64')
                }
                break
            //handle standard token contract events
            //see https://github.com/stellar/rs-soroban-sdk/blob/71170fba76e1aa4d50224316f1157f0fb10e6d79/soroban-sdk/src/token.rs
            case 'transfer': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    return
                const from = xdrParseScVal(topics[1])
                const to = xdrParseScVal(topics[2])
                if (to === from) //self transfer - nothing happens
                    return // TODO: need additional checks
                const sorobanAsset = contractId
                const amount = processEventBodyValue(body.data())
                if (!this.matchInvocationEffect(e =>
                    (e.function === 'transfer' && matchArrays([from, to, amount], e.args)) ||
                    (e.function === 'transfer_from' && matchArrays([undefined, from, to, amount], e.args))
                ))
                    return
                let classicAsset
                if (topics.length > 3) {
                    classicAsset = xdrParseAsset(xdrParseScVal(topics[3]))
                    //validate
                    if (contractIdFromAsset(toStellarAsset(classicAsset), this.effectAnalyzer.network) !== sorobanAsset)
                        return //not an SAC transfer
                }
                if (classicAsset && (classicAsset.includes(from) || classicAsset.includes(to))) { //SAC transfer by asset issuer
                    if (classicAsset.includes(from)) {
                        this.effectAnalyzer.mint(sorobanAsset, amount)
                        this.effectAnalyzer.credit(amount, isContractAddress(to) ? sorobanAsset : classicAsset, to)
                    }
                    if (classicAsset.includes(to)) {
                        this.effectAnalyzer.debit(amount, isContractAddress(from) ? sorobanAsset : classicAsset, from)
                        this.effectAnalyzer.burn(sorobanAsset, amount)
                    }
                } else { //other cases
                    if (classicAsset && !isContractAddress(from)) { //classic asset bridged to Soroban
                        this.effectAnalyzer.burn(classicAsset, amount)
                        this.effectAnalyzer.mint(sorobanAsset, amount)
                    } else {
                        this.effectAnalyzer.debit(amount, isContractAddress(from) ? sorobanAsset : classicAsset, from)
                    }
                    if (classicAsset && !isContractAddress(to)) { //classic asset bridged from Soroban
                        this.effectAnalyzer.burn(sorobanAsset, amount)
                        this.effectAnalyzer.mint(classicAsset, amount)
                    } else {
                        this.effectAnalyzer.credit(amount, isContractAddress(to) ? sorobanAsset : classicAsset, to)
                    }
                }

            }
                break
            case 'mint': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    return //throw new Error('Non-standard event')
                const to = xdrParseScVal(topics[1])
                const amount = processEventBodyValue(body.data())
                if (!this.matchInvocationEffect(e => e.function === 'mint' && matchArrays([to, amount], e.args)))
                    return
                this.effectAnalyzer.addEffect({
                    type: effectTypes.assetMinted,
                    asset: contractId,
                    amount
                })
                this.effectAnalyzer.credit(amount, contractId, to)
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

                this.effectAnalyzer.debit(amount, contractId, from)
                this.effectAnalyzer.burn(contractId, amount)
            }
                break
            case 'clawback': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    return //throw new Error('Non-standard event')
                const admin = xdrParseScVal(topics[1])
                const from = xdrParseScVal(topics[2])
                const amount = processEventBodyValue(body.data())
                if (!this.matchInvocationEffect(e => e.function === 'clawback' && matchArrays([from, amount], e.args)))
                    return
                this.effectAnalyzer.debit(amount, contractId, from)
                this.effectAnalyzer.burn(contractId, amount)
            }
                break
            //TODO: process token allowance, authorization approval, and admin modification for SAC contracts
            /*case 'approve': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    throw new Error('Non-standard event')
                const from = xdrParseScVal(topics[1])
                const spender = xdrParseScVal(topics[2])
            }
                break

            case 'set_authorized': {
                throw new Error('Not implemented')
                //trustlineAuthorizationUpdated
                if (!matchEventTopicsShape(topics, ['address', 'address', 'bool', 'str?']))
                    throw new Error('Non-standard event')
                const admin = xdrParseScVal(topics[1])
                const id = xdrParseScVal(topics[2])
                const authorize = xdrParseScVal(topics[3])
            }
                break
            case 'set_admin': {
                throw new Error('Not implemented')
                if (!matchEventTopicsShape(topics, ['address']))
                    throw new Error('Non-standard event')
                const prevAdmin = xdrParseScVal(topics[1])
                const newAdmin = processEventBodyValue(topics[2])
            }
                break*/
            default:
                //console.log(`Event ` + xdrParseScVal(topics[0]))
                break
        }
        return null
    }

    matchInvocationEffect(cb) {
        return this.effectAnalyzer.effects.find(e => e.type === effectTypes.contractInvoked && cb(e))
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