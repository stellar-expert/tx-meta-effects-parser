/*eslint-disable no-undef */
const {Networks} = require('stellar-sdk')
const {parseTxOperationsMeta} = require('../src/index')
const {effectTypes} = require('../src/tx-effects-analyzer')

const unmatchedEffects = new Set()
for (const effectType of Object.values(effectTypes)) {
    if (!isNaN(effectType))
        continue
    unmatchedEffects.add(effectType)
}

const matchedEffects = new Set()


describe('Effects analyzer', () => {
    test.each(require('./op-effects-data.json'))('Analyze operation effects - %s', (description, {tx, result, meta, expected}) => {
        //merge account
        const res = parseTxOperationsMeta({
            network: Networks.TESTNET,
            tx,
            result,
            meta
        })

        for (let i = 0; i < res.operations.length; i++) {
            for (let j = 0; j < res.operations[i].effects.length; j++) {
                const {type} = res.operations[i].effects[j]
                if (unmatchedEffects.has(type)) {
                    unmatchedEffects.delete(type)
                }
                matchedEffects.add(type)
            }
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

        for (let i = 0; i < res.effects.length; i++) {
            const {type} = res.effects[i]
            if (unmatchedEffects.has(type)) {
                unmatchedEffects.delete(type)
            }
            matchedEffects.add(type)
        }
    })

    test('All effects are matched', () => {
        const unmatched = unmatchedEffects.size > 0 ? `Unmatched effects: ${[...unmatchedEffects].join(', ')}` : 0
        expect(unmatched).toBe('')
    })
})