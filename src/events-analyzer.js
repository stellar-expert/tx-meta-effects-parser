const {StrKey} = require('stellar-base')
const {xdrParseScVal, xdrParseAsset} = require('./tx-xdr-parser-utils')
const {UnexpectedTxMetaChangeError} = require('./errors')
const {encodeAssetContractId} = require('./asset-contract-id-encoder')
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
            const topics = body.topics().map(xdrParseScVal)
            if (topics[0] === 'DATA' && topics[1] === 'set')
                continue //skip data entries modifications
            //add event to the pipeline
            this.effectAnalyzer.addEffect({
                type: effectTypes.contractEvent,
                contract: StrKey.encodeContract(evt.contractId()),
                topics,
                data: processEventBodyValue(body.data())
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
                throw new UnexpectedTxMetaChangeError({type: 'diagnostic_event', action: 'failed'})
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
        switch (xdrParseScVal(topics[0])) {
            case 'fn_call': // contract call
                if (type !== EVENT_TYPES.DIAGNOSTIC)
                    return // skip non-diagnostic events
                const parsedEvent = {
                    type: effectTypes.contractInvoked,
                    contract: xdrParseScVal(topics[1], true),
                    function: xdrParseScVal(topics[2]),
                    args: processEventBodyValue(body.data())
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
                const parsedResult = body.data().value()
                if (parsedResult !== undefined) {
                    funcCall.result = parsedResult
                }
                break
            //handle standard token contract events
            case 'transfer': {
                const from = xdrParseScVal(topics[1])
                const to = xdrParseScVal(topics[2])
                const token = this.parseToken(topics[3] || contractId)
                const amount = processEventBodyValue(body.data())
                this.debit(from, token, amount)
                this.credit(to, token, amount)
            }
                break
            case 'approve': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    throw new Error('Non-standard event')
                const from = xdrParseScVal(topics[1])
                const spender = xdrParseScVal(topics[2])
            }
                break
            case 'mint': {
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    throw new Error('Non-standard event')
                const to = xdrParseScVal(topics[1])
                const token = new TokenDescriptor(contractId)
                const amount = processEventBodyValue(body.data())
                this.effectAnalyzer.addEffect({
                    type: effectTypes.assetMinted,
                    asset: contractId,
                    amount
                })
                this.credit(to, token, amount)            }
                break
            case 'burn': {
                throw new Error('Not implemented')
                if (!matchEventTopicsShape(topics, ['address', 'str?']))
                    throw new Error('Non-standard event')
                const from = xdrParseScVal(topics[1])
            }
                break
            case 'clawback': {
                throw new Error('Not implemented')
                if (!matchEventTopicsShape(topics, ['address', 'address', 'str?']))
                    throw new Error('Non-standard event')
                const admin = xdrParseScVal(topics[1])
                const from = xdrParseScVal(topics[2])
            }
                break
            case 'set_authorized': {
                throw new Error('Not implemented')
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
                break
            default:
                console.log(`Event ` + xdrParseScVal(topics[0]))
        }
        return null
    }

    /**
     * @param {ScVal | String} src
     * @return {TokenDescriptor}
     * @private
     */
    parseToken(src) {
        return new TokenDescriptor(typeof src === 'string' ? src : xdrParseScVal(src), this.effectAnalyzer.network)
    }

    /**
     * @param {String} from
     * @param {TokenDescriptor} token
     * @param {String} amount
     * @private
     */
    debit(from, token, amount) {
        const effect = {
            type: effectTypes.contractDebited,
            contract: from,
            asset: token.asset,
            amount
        }
        if (token.anchoredAsset) {
            effect.anchoredAsset = token.anchoredAsset
        }
        this.effectAnalyzer.addEffect(effect)
    }

    /**
     * @param {String} to
     * @param {TokenDescriptor} token
     * @param {String} amount
     * @private
     */
    credit(to, token, amount) {
        const effect = {
            type: effectTypes.contractCredited,
            contract: to,
            asset: token.asset,
            amount
        }
        if (token.anchoredAsset) {
            effect.anchoredAsset = token.anchoredAsset
        }
        this.effectAnalyzer.addEffect(effect)
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

function processEventBodyValue(value) {
    const innerValue = value.value()
    if (innerValue instanceof Array) //handle simple JS arrays
        return innerValue.map(xdrParseScVal)
    if (!innerValue) //scVoid
        return undefined
    return xdrParseScVal(value) //other scValue
}

function isContractAddress(address) {
    return address.length === 56 && address[0] === 'C'
}

class TokenDescriptor {
    constructor(rawAsset, network) {
        if (isContractAddress(rawAsset)) {
            this.asset = rawAsset
        } else {
            this.asset = encodeAssetContractId(rawAsset, network)
            this.anchoredAsset = xdrParseAsset(rawAsset)
        }
    }

    /**
     * @type {String}
     * @readonly
     */
    asset

    /**
     * @type {String}
     * @readonly
     */
    anchoredAsset

    get kind() {
        if (this.anchoredAsset)
            return 'anchored'
        return 'contract'
    }
}

module.exports = EventsAnalyzer