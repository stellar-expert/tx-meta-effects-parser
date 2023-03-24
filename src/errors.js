class TxMetaEffectParserError extends Error {
    constructor(message) {
        super('Transaction metadata processing error. ' + message)
    }
}

class UnexpectedTxMetaChangeError extends TxMetaEffectParserError {
    constructor({type, action}) {
        super(`Unexpected meta changes: "${type}" "${action}"`)
    }
}

module.exports = {UnexpectedTxMetaChangeError, TxMetaEffectParserError}