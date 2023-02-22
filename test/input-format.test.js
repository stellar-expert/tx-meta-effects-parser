const {xdr, Networks} = require('stellar-sdk')
const {parseTxOperationsMeta} = require('../src/index')
const [txExample] = require('./tx-effects-data.json')

const {tx, result, meta, expected} = txExample[1]

const testCases = [
    ['base64 encoding', {tx, result, meta}],
    ['raw buffer', {
        tx: Buffer.from(tx, 'base64'),
        result: Buffer.from(result, 'base64'),
        meta: Buffer.from(meta, 'base64')
    }],
    ['parsed XDR', {
        tx: xdr.TransactionEnvelope.fromXDR(tx, 'base64'),
        result: xdr.TransactionResult.fromXDR(result, 'base64'),
        meta: xdr.TransactionMeta.fromXDR(meta, 'base64')
    }]
]

describe('Input format variations', () => {
    test.each(testCases)('Checking %s format', (description, {tx, result, meta}) => {
        const res = parseTxOperationsMeta({
            network: Networks.TESTNET,
            tx,
            result,
            meta
        })

        expect(res.fee).toStrictEqual(expected)
    })
})