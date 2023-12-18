/*eslint-disable no-undef */
const {parseTxOperationsMeta} = require('../src/index')

const network = 'Test SDF Future Network ; October 2022'
describe('Effects', () => {
    test.each(require('./op-effects-data.json'))('Analyze classic operation effects - %s', (description, {tx, result, meta, expected}) => {
        const res = parseTxOperationsMeta({
            network,
            tx,
            result,
            meta
        })

        for (let i = 0; i < res.operations.length; i++) {
            expect(res.operations[i].effects).toStrictEqual(expected[i])
        }
    })

    test.each(require('./soroban-op-effects-data.json'))('Analyze Soroban operation effects - %s', (description, {tx, result, meta, expected}) => {
        const res = parseTxOperationsMeta({
            network,
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
            network,
            tx,
            result,
            meta
        })

        expect(res.effects).toStrictEqual(expected)
    })
})