const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')
const {TxMetaEffectParserError} = require('./errors')

/**
 * Parse top-level transaction metadata changes
 * @param {TransactionMeta} meta
 * @return {ParsedLedgerEntryMeta[]}
 */
function parseTxMetaChanges(meta) {
    const transactionMeta = meta.value()
    const txMetaChanges = []

    switch (meta.arm()) {
        case 'v1':
            retrieveTopLevelChanges(transactionMeta.txChanges(), txMetaChanges)
            break
        case 'v2':
        case 'v3':
            retrieveTopLevelChanges(transactionMeta.txChangesBefore(), txMetaChanges)
            retrieveTopLevelChanges(transactionMeta.txChangesAfter(), txMetaChanges)
            break
        default:
            throw new TxMetaEffectParserError(`Transaction meta version ${meta.arm()} is not supported.`)
    }

    return txMetaChanges
}

function retrieveTopLevelChanges(changes, res) {
    for (const entry of parseLedgerEntryChanges(changes)) {
        res.push(entry)
    }
}

module.exports = {parseTxMetaChanges}