const {StrKey} = require('stellar-base')
const {xdrParseScVal, xdrParseAsset} = require('./tx-xdr-parser-utils')
const {fromStroops} = require('./analyzer-primitives')
const {UnexpectedTxMetaChangeError} = require('./errors')
const {encodeAssetContractId} = require('./asset-contract-id-encoder')
const effectTypes = require('./effect-types')

class EventsAnalyzer {
    constructor(effectAnalyzer) {
        this.effectAnalyzer = effectAnalyzer
    }

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
        const callStack = []
        //diagnostic events
        for (const evt of diagnosticEvents) {
            if (!evt.inSuccessfulContractCall())
                throw new UnexpectedTxMetaChangeError({type: 'diagnostic_event', action: 'failed'})
            //parse event
            const parsedEvent = this.processDiagnosticEvent(evt.event().body().value())
            if (!parsedEvent) //no effects
                continue
            if (parsedEvent instanceof Array) { //transfer op args
                for (const e of parsedEvent) {
                    this.effectAnalyzer.addEffect(e)
                }
            } else {
                if (parsedEvent.type) {
                    this.effectAnalyzer.addEffect(parsedEvent)
                    //add the invocation to the callstack
                    if (parsedEvent.type === effectTypes.contractInvoked) {
                        if (callStack.length) {
                            parsedEvent.depth = callStack.length
                        }
                        callStack.push(parsedEvent)
                    }
                } else {
                    //attach execution result to the contract invocation event
                    const funcCall = callStack.pop()
                    if (parsedEvent.result !== undefined) {
                        funcCall.result = parsedEvent.result
                    }
                }
            }
        }
    }

    /**
     * @private
     */
    processDiagnosticEvent(body) {
        const topics = body.topics()
        switch (xdrParseScVal(topics[0])) {
            case 'fn_call': // contract call
                return {
                    type: effectTypes.contractInvoked,
                    contract: xdrParseScVal(topics[1], true),
                    function: xdrParseScVal(topics[2]),
                    args: processEventBodyValue(body.data())
                }
            case 'transfer': //transfer of the built-in token contract
                const from = xdrParseScVal(topics[1], true)
                const to = xdrParseScVal(topics[2], true)
                const rawAsset = xdrParseScVal(topics[3])
                const asset = encodeAssetContractId(rawAsset, this.effectAnalyzer.network)
                const anchoredAsset = xdrParseAsset(rawAsset)
                const amount = fromStroops(processEventBodyValue(body.data()))
                const transferEvents = []
                //contract balance debited
                if (isContractAddress(from)) {
                    const effect = {
                        type: effectTypes.contractDebited,
                        contract: from,
                        asset,
                        amount
                    }
                    if (anchoredAsset) {
                        effect.anchoredAsset = anchoredAsset
                    }
                    transferEvents.push(effect)
                }
                //contract balance credited
                if (isContractAddress(to)) {
                    const effect = {
                        type: effectTypes.contractCredited,
                        contract: to,
                        asset,
                        amount
                    }
                    if (anchoredAsset) {
                        effect.anchoredAsset = anchoredAsset
                    }
                    transferEvents.push(effect)
                }
                return transferEvents
            case 'fn_return':
                //handle return value
                return {result: body.data().value()}
        }
        return null
    }
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
    return address.startsWith('C')
}


module.exports = EventsAnalyzer