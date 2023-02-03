const {parseLedgerEntryChanges} = require('./ledger-entry-changes-parser')

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
            for (const ch of transactionMeta.txChanges()) {
                txMetaChanges.push(parseLedgerEntryChanges(ch))
            }
            break
        case 'v2':
            for (const ch of transactionMeta.txChangesBefore()) {
                txMetaChanges.push(parseLedgerEntryChanges(ch))
            }
            for (const ch of transactionMeta.txChangesAfter()) {
                txMetaChanges.push(parseLedgerEntryChanges(ch))
            }
            break
        default:
            throw new Error(`Transaction meta version ${meta.arm()} is not supported.`)
    }

    return txMetaChanges
}

module.exports = {parseTxMetaChanges}