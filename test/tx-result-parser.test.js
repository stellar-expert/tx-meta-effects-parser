/*eslint-disable no-undef */
const {Networks} = require('stellar-base')
const {parseTxOperationsMeta} = require('../src/index')


describe('Effects', () => {
    test.each(require('./op-effects-data.json'))('Analyze operation effects - %s', (description, {tx, result, meta, expected}) => {
        //merge account
        const res = parseTxOperationsMeta({
            network: Networks.TESTNET,
            tx,
            result,
            meta
        })

        for (let i = 0; i < res.operations.length; i++) {
            expect(res.operations[i].effects).toStrictEqual(expected[i])
        }
    })

    test.each(require('./tx-effects-data.json'))('Analyze transaction effects - %s', (description, {tx, result, meta, expected}) => {
        //merge account
        const res = parseTxOperationsMeta({
            network: Networks.TESTNET,
            tx,
            result,
            meta
        })

        expect(res.effects.find(e => e.type === 'feeCharged')).toStrictEqual(expected)
    })
})