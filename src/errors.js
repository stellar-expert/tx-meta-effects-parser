class UnexpectedMetaChangeError extends Error {
    constructor({type, action}) {
        super(`Unexpected meta changes: "${type}" "${action}"`)
    }
}

module.exports = {UnexpectedMetaChangeError}