# @stellar-expert/tx-meta-effects-parser

> Low-level effects parser for Stellar transaction results and meta XDR

Some [Stellar](https://stellar.org) operations yield non-deterministic results,
so developers often have to pull the data from Horizon `/effects` API endpoints.
This package provides the ability to retrieve atomic ledger state modifications
directly from the transaction execution result and metadata.

## Installation

```
npm i @stellar-expert/tx-meta-effects-parser
```

## Usage

```js
const {parseTxOperationsMeta} = require('@stellar-expert/tx-meta-effects-parser')

const res = parseTxOperationsMeta({
  network: 'Public Global Stellar Network ; September 2015',
  tx: '_base64-encoded_transaction_envelope_XDR_',
  result: '_base64-encoded_transaction_result_XDR_',
  meta: '_base64-encoded_transaction_result_meta_XDR_'
})

console.log(res.effects)
console.log(res.operations[0].effects)
```

## All effects

<table>
<tr>
<th>Effect</th> <th>Yielded by</th> <th>Example</th>
</tr>

<tr>
<td>
<code>feeCharged</code>
</td>
<td>Transaction, FeeBumpTransaction</td>
<td>

```js
{
  type: 'feeCharged',
  source: 'GBKP…YDLI',
  asset: 'XLM',
  bid: '0.001',
  charged: '0.00001'
}
```
</td>
</tr>

<tr>
<td>
<code>accountCreated</code>
</td>
<td>CreateAccountOp</td>
<td>

```js
{
  type: 'accountCreated',
  source: 'GBKP…YDLI',
  account: 'GBWC…DXHN'
}
```
</td>
</tr>

<tr>
<td>
<code>accountRemoved</code>
</td>
<td>AccountMergeOp</td>
<td>

```js
{
  type: 'accountRemoved',
  source: 'GBKP…YDLI'
}
```
</td>
</tr>

<tr>
<td>
<code>accountDebited</code>
</td>
<td>CreateAccountOp, AccountMergeOp, PaymentOp, PathPaymentStrictReceiveOp,
PathPaymentStrictSendOp, CreateClaimableBalanceOp, ClawbackOp</td>
<td>

```js
{
  type: 'accountDebited',
  source: 'GBKP…YDLI',
  asset: 'XLM',
  amount: '100'
}
```
</td>
</tr>

<tr>
<td>
<code>accountCredited</code>
</td>
<td>CreateAccountOp, AccountMergeOp, PaymentOp, PathPaymentStrictReceiveOp,
PathPaymentStrictSendOp, ClaimClaimableBalanceOp, ClawbackOp, 
ClawbackClaimableBalance, InflationOp</td>
<td>

```js
{
  type: 'accountCredited',
  source: 'GBWC…DXHN',
  asset: 'XLM',
  amount: '100'
}
```
</td>
</tr>

<tr>
<td>
<code>accountHomeDomainUpdated</code>
</td>
<td>SetOptionsOp</td>
<td>

```js
{
  type: 'accountHomeDomainUpdated',
  source: 'GBWC…DXHN',
  domain: 'example.com'
}
```
</td>
</tr>

<tr>
<td>
<code>accountThresholdsUpdated</code>
</td>
<td>SetOptionsOp</td>
<td>

```js
{
  type: 'accountThresholdsUpdated',
  source: 'GBWC…DXHN',
  thresholds: [1, 1 ,3]
}
```
</td>
</tr>

<tr>
<td>
<code>accountFlagsUpdated</code>
</td>
<td>SetOptionsOp</td>
<td>

```js
{
  type: 'accountFlagsUpdated',
  source: 'GBWC…DXHN',
  flags: 2,
  prevFlags: 0
}
```
</td>
</tr>

<tr>
<td>
<code>accountInflationDestinationUpdated</code>
</td>
<td>SetOptionsOp</td>
<td>

```js
{
  type: 'accountInflationDestinationUpdated',
  source: 'GBWC…DXHN',
  inflationDestination: 'GBKP…YDLI'
}
```
</td>
</tr>

<tr>
<td>
<code>accountSignerCreated</code>
</td>
<td>SetOptionsOp</td>
<td>

```js 
{
  type: 'accountSignerCreated',
  source: 'GBWC…DXHN',
  signer: 'GBKP…YDLI',
  weight: 1,
  signers: [
    {key: 'GBWC…DXHN', weight: 1},
    {key: 'GBKP…YDLI', weight: 1}
  ]
}
```

</td>
</tr>

<tr>
<td>
<code>accountSignerUpdated</code>
</td>
<td>SetOptionsOp</td>
<td>

```js 
{
  type: 'accountSignerUpdated',
  source: 'GBWC…DXHN',
  signer: 'GBKP…YDLI',
  weight: 2,
  signers: [
    {key: 'GBWC…DXHN', weight: 2},
    {key: 'GBKP…YDLI', weight: 1}
  ]
}
```

</td>
</tr>

<tr>
<td>
<code>accountSignerRemoved</code>
</td>
<td>SetOptionsOp</td>
<td>

```js
{
  type: 'accountSignerRemoved',
  source: 'GBWC…DXHN',
  weight: 0,
  signer: 'GBKP…YDLI',
  signers: [
    {key: 'GBWC…DXHN', weight: 1}
  ]
}
```

</td>
</tr>

<tr>
<td>
<code>trustlineCreated</code>
</td>
<td>ChangeTrustOp</td>
<td>

```js
{
  type: 'trustlineCreated',
  source: 'GBWC…DXHN',
  asset: 'USD-GBKP…YDLI-1',
  kind: 'asset',
  limit: '100',
  flags: 1
}
```

</td>
</tr>

<tr>
<td>
<code>trustlineUpdated</code>
</td>
<td>ChangeTrustOp, AllowTrustOp, SetTrustLineFlagsOp</td>
<td>

```js
{
  type: 'trustlineUpdated',
  source: 'GBWC…DXHN',
  asset: 'USD-GBKP…YDLI-1',
  kind: 'asset',
  limit: '200',
  flags: 5
}
```

</td>
</tr>

<tr>
<td>
<code>trustlineRemoved</code>
</td>
<td>ChangeTrustOp</td>
<td>

```js
{
  type: 'trustlineRemoved',
  source: 'GBWC…DXHN',
  asset: 'USD-GBKP…YDLI-1',
  kind: 'asset',
  flags: 4,
}
```

</td>
</tr>

<tr>
<td>
<code>trustlineAuthorizationUpdated</code>
</td>
<td>AllowTrustOp, SetTrustLineFlagsOp</td>
<td>

```js
{
  type: 'trustlineAuthorizationUpdated',
  source: 'GBWC…DXHN',
  trustor: 'GBKP…YDLI',
  asset: 'USD-GBWC…DXHN-1',
  flags: 5,
  prevFlags: 2
}
```

</td>
</tr>

<tr>
<td>
<code>assetMinted</code>
</td>
<td>PaymentOp, PathPaymentStrictReceiveOp, PathPaymentStrictSendOp, CreateClaimableBalanceOp,
ManageBuyOfferOp, ManageSellOfferOp, CreatePassiveOfferOp, DepositLiquidityOp</td>
<td>

```js
{
  type: 'assetMinted',
  source: 'GBWC…DXHN',
  asset: 'USD-GBWC…DXHN-1',
  amount: 100,
}
```

</td>
</tr>

<tr>
<td>
<code>assetBurned</code>
</td>
<td>PaymentOp, PathPaymentStrictReceiveOp, PathPaymentStrictSendOp, CreateClaimableBalanceOp, ManageBuyOfferOp, ManageSellOfferOp,
CreatePassiveOfferOp, WithdrawLiquidityOp, ClawbackOp,
ClaimClaimableBalanceOp</td>
<td>

```js
{
  type: 'assetBurned',
  source: 'GBWC…DXHN',
  asset: 'USD-GBWC…DXHN-1',
  amount: 200,
}
```

</td>
</tr>

<tr>
<td>
<code>offerCreated</code>
</td>
<td>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp</td>
<td>

```js
{
  type: 'offerCreated',
  source: 'GBWC…DXHN',
  offer: '90427',
  owner: 'GBWC…DXHN',
  amount: '100',
  asset: [
    'USD-GBKP…YDLI-1',
    'XLM'
  ],
  price: 0.09215,
  flags: 0
}
```

</td>
</tr>

<tr>
<td>
<code>offerUpdated</code>
</td>
<td>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp, PathPaymentOp</td>
<td>

```js
{
  type: 'offerUpdated',
  source: 'GBWC…DXHN',
  offer: '90427',
  owner: 'GBWC…DXHN',
  amount: '90',
  asset: [
    'USD-GBKP…YDLI-1',
    'XLM'
  ],
  price: 0.09215,
  flags: 0
}
```

</td>
</tr>

<tr>
<td>
<code>offerRemoved</code>
</td>
<td>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp, PathPaymentOp, AllowTrustOp, SetTrustLineFlagsOp</td>
<td>

```js
{
  type: 'offerRemoved',
  source: 'GBWC…DXHN',
  offer: '90427',
  owner: 'GBWC…DXHN',
  asset: [
    'USD-GBKP…YDLI-1',
    'XLM'
  ],
  flags: 0
}
```

</td>
</tr>

<tr>
<td>
<code>liquidityPoolCreated</code>
</td>
<td>ChangeTrustOp</td>
<td>

```js
{
  type: 'liquidityPoolCreated',
  source: 'GBWC…DXHN',
  pool: '52a8…76f8',
  reserves: [
    {
      asset: 'XLM',
      amount: '0'
    },
    {
      asset: 'USD-GBKP…YDLI-1',
      amount: '0'
    }
  ],
  shares: '0',
  accounts: 1
}
```

</td>
</tr>

<tr>
<td>
<code>liquidityPoolUpdated</code>
</td>
<td>DepositLiquidityOp, WithdrawLiquidityOp, AllowTrustOp, SetTrustLineFlagsOp</td>
<td>

```js
{
  type: 'liquidityPoolUpdated',
  source: 'GBWC…DXHN',
  pool: '52a8…76f8',
  reserves: [
    {
      asset: 'XLM',
      amount: '1000'
    },
    {
      asset: 'USD-GBKP…YDLI-1',
      amount: '1000'
    }
  ],
  shares: '10000000000',
  accounts: 2
}
```

</td>
</tr>

<tr>
<td>
<code>liquidityPoolDeposited</code>
</td>
<td>DepositLiquidityOp</td>
<td>

```js
{
  type: 'liquidityPoolDeposited',
  source: 'GBWC…DXHN',
  pool: '52a8…76f8',
  assets: [
    {
      asset: 'XLM',
      amount: '1000'
    },
    {
      asset: 'USD-GBKP…YDLI-1',
      amount: '1000'
    }
  ],
  shares: '10000000000'
}
```

</td>
</tr>

<tr>
<td>
<code>liquidityPoolWithdrew</code>
</td>
<td>WithdrawLiquidityOp</td>
<td>

```js
{
  type: 'liquidityPoolWithdrew',
  source: 'GBWC…DXHN',
  pool: '52a8…76f8',
  assets: [
    {
      asset: 'XLM',
      amount: '500'
    },
    {
      asset: 'USD-GBKP…YDLI-1',
      amount: '500'
    }
  ],
  shares: '5000000000'
}
```

</td>
</tr>

<tr>
<td>
<code>liquidityPoolRemoved</code>
</td>
<td>ChangeTrustOp, AllowTrustOp, SetTrustLineFlagsOp</td>
<td>

```js
{
  type: 'liquidityPoolRemoved',
  source: 'GBWC…DXHN',
  pool: '52a8…76f8'
}
```

</td>
</tr>

<tr>
<td>
<code>trade</code>
</td>
<td>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp, PathPaymentOp</td>
<td>

```js
{
  type: 'trade',
  source: 'GBWC…DXHN',
  offer: '1',
  amount: ['10', '10'],
  asset: [
    'USD-GBKP…YDLI-1',
    'XLM'
  ],
  seller: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<code>dataEntryCreated</code>
</td>
<td>ManageDataOp</td>
<td>

```js
{
  type: 'dataEntryCreated',
  source: 'GBWC…DXHN',
  name: 'test',
  value: 'dGVzdA=='
}
```

</td>
</tr>

<tr>
<td>
<code>dataEntryUpdated</code>
</td>
<td>ManageDataOp</td>
<td>

```js
{
  type: 'dataEntryUpdated',
  source: 'GBWC…DXHN',
  name: 'test',
  value: 'dGVzVA=='
}
```

</td>
</tr>

<tr>
<td>
<code>dataEntryRemoved</code>
</td>
<td>ManageDataOp</td>
<td>

```js
{
  type: 'dataEntryRemoved',
  source: 'GBWC…DXHN',
  name: 'test'
}
```

</td>
</tr>

<tr>
<td>
<code>sequenceBumped</code>
</td>
<td>BumpSequenceOp</td>
<td>

```js
{
  type: 'sequenceBumped',
  source: 'GBWC…DXHN',
  sequence: '100'
}
```

</td>
</tr>

<tr>
<td>
<code>inflation</code>
</td>
<td>InflationOp</td>
<td>

```js
{
  type: 'inflation',
  source: 'GBWC…DXHN'
}
```

</td>
</tr>

<tr>
<td>
<code>claimableBalanceCreated</code>
</td>
<td>CreateClaimableBalanceOp, AllowTrustOp, SetTrustLineFlagsOp</td>
<td>

```js
{
  type: 'claimableBalanceCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d',
  asset: 'XLM',
  amount: '100',
  claimants: [
    {
      destination: 'GBKP…YDLI',
      predicate: {
        absBefore: '1671220240580'
      }
    }
  ]
}
```

</td>
</tr>

<tr>
<td>
<code>claimableBalanceRemoved</code>
</td>
<td>ClaimClaimableBalanceOp, ClawbackClaimableBalanceOp</td>
<td>

```js
{
  type: 'claimableBalanceRemoved',
  source: 'GBKP…YDLI',
  sponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d',
  asset: 'XLM',
  amount: '100',
  claimants: [
    {
      destination: 'GBKP…YDLI',
      predicate: {
        absBefore: '1671220240580'
      }
    }
  ]
}
```

</td>
</tr>

<tr>
<td>
<code>accountSponsorshipCreated</code>
</td>
<td>CreateAccountOp</td>
<td>

```js
{
  type: 'accountSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<code>accountSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'accountSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<code>accountSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'accountSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<code>trustlineSponsorshipCreated</code>
</td>
<td>ChangeThrustOp</td>
<td>

```js
{
  type: 'trustlineSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  asset: 'USD-GBKP…YDLI-1'
}
```

</td>
</tr>

<tr>
<td>
<code>trustlineSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'trustlineSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  asset: 'USD-GBKP…YDLI-1'
}
```

</td>
</tr>

<tr>
<td>
<code>trustlineSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'trustlineSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  asset: 'USD-GBKP…YDLI-1'
}
```

</td>
</tr>

<tr>
<td>
<code>offerSponsorshipCreated</code>
</td>
<td>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp</td>
<td>

```js
{
  type: 'offerSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  offer: '100'
}
```

</td>
</tr>

<tr>
<td>
<code>offerSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'offerSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  offer: '100'
}
```

</td>
</tr>

<tr>
<td>
<code>offerSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'offerSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  offer: '100'
}
```

</td>
</tr>

<tr>
<td>
<code>dataSponsorshipCreated</code>
</td>
<td>ManageDataOp</td>
<td>

```js
{
  type: 'dataSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  name: 'name'
}
```

</td>
</tr>

<tr>
<td>
<code>dataSponsorshipUpdated</code> 
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'dataSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  name: 'name'
}
```

</td>
</tr>

<tr>
<td>
<code>dataSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'dataSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  name: 'name'
}
```

</td>
</tr>

<tr>
<td>
<code>claimableBalanceSponsorshipCreated</code>
</td>
<td>CreateClaimableBalanceOp</td>
<td>

```js
{
  type: 'claimableBalanceSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d'
}
```

</td>
</tr>

<tr>
<td>
<code>claimableBalanceSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'claimableBalanceSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d'
}
```

</td>
</tr>

<tr>
<td>
<code>claimableBalanceSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'claimableBalanceSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d'
}
```

</td>
</tr>

<tr>
<td>
<code>signerSponsorshipCreated</code>
</td>
<td>SetOptionsOp</td>
<td>

```js
{
  type: 'signerSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  signer: 'GALF…CR2V',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<code>signerSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js 
{
  type: 'signerSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  signer: 'GALF…CR2V',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<code>signerSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'signerSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  signer: 'GALF…CR2V',
  account: 'GBKP…YDLI'
}
```

</td>
</tr>

<tr>
<td>
<code>liquidityPoolSponsorshipCreated</code>
</td>
<td>ChangeThrustOp</td>
<td>

```js
{
  type: 'liquidityPoolSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN'
}
```

</td>
</tr>

<tr>
<td>
<code>liquidityPoolSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'liquidityPoolSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN'
}
```

</td>
</tr>

<tr>
<td>
<code>liquidityPoolSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>

```js
{
  type: 'liquidityPoolSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN'
}
```

</td>
</tr>

<tr>
<td>
<code>contractCodeUploaded</code>
</td>
<td>InvokeHostFunctionOp</td>
<td>

```js
{
  type: 'contractCodeUploaded',
  source: 'GBWC…DXHN',
  wasm: 'AGFz…AAAF',
  wasmHash: '5c55…e46d',
  keyHash: 'a833…f27f'
}
```

</td>
</tr>

<tr>
<td>
<code>contractCodeRemoved</code>
</td>
<td>InvokeHostFunctionOp</td>
<td>

```js
{
  type: 'contractCodeRemoved',
  source: 'GBWC…DXHN',
  wasmHash: '5c55…e46d',
  keyHash: 'a833…f27f'
}
```

</td>
</tr>

<tr>
<td>
<code>contractCreated</code>
</td>
<td>InvokeHostFunctionOp</td>
<td>

```js
{
  type: 'contractCreated',
  source: 'GBWC…DXHN',
  contract: 'CBIH…AZAD',
  kind: 'fromAsset',
  asset: 'ICGVCWUQXIHO-GBD2…FUAC-2'
}
```

</td>
</tr>

<tr>
<td>
<code>contractUpdated</code>
</td>
<td>InvokeHostFunctionOp</td>
<td>

```js
{
  type: 'contractUpdated',
  source: 'GBWC…DXHN',
  contract: 'CBIH…AZAD',
  kind: 'wasm',
  wasmHash: '5c55…e46d',
  prevWasmHash: 'eb94…19ae'

}
```

</td>
</tr>

<tr>
<td>
<code>contractInvoked</code>
</td>
<td>InvokeHostFunctionOp</td>
<td>

```js
{
  type: 'contractInvoked',
  source: 'GBWC…DXHN',
  contract: 'CBIH…AZAD',
  function: 'mint',
  rawArgs: 'AAAA…Ag==',
  depth: 1,
  args: [
    'CDFD…ITT3',
    '1000'
  ]
}
```

</td>
</tr>

<tr>
<td>
<code>contractError</code>
</td>
<td>InvokeHostFunctionOp</td>
<td>

```js
{
  type: 'contractError',
  source: 'GB6V…UIYN',
  contract: 'CBIH…AZAD',
  code: 13,
  details: [
    'trustline entry is missing for account',
    'GB6V…UIYN'
  ]
}
```

</td>
</tr>

<tr>
<td>
<code>contractDataCreated</code>
</td>
<td>InvokeHostFunctionOp</td>
<td>

```js
{
  type: 'contractDataCreated',
  source: 'GC3E…XMJY',
  owner: 'CCM3…OFJX',
  key: 'AAAA…0SQ=',
  value: 'AAAA…AA==',
  durability: 'persistent',
  keyHash: '2177…a56a'
}
```

</td>
</tr>

<tr>
<td>
<code>contractDataUpdated</code>
</td>
<td>InvokeHostFunctionOp</td>
<td>

```js
{
  type: 'contractDataUpdated',
  source: 'GC3E…XMJY',
  owner: 'CCM3…OFJX',
  key: 'AAAAFA==',
  value: 'AAAA…AA==',
  prevValue: 'AAAA…AAA=',
  durability: 'persistent',
  keyHash: '2177…a56a'
}
```

</td>
</tr>

<tr>
<td>
<code>contractDataRemoved</code>
</td>
<td>InvokeHostFunctionOp</td>
<td>

```js
{
  type: 'contractDataRemoved',
  source: 'GC3E…XMJY',
  owner: 'CCM3…OFJX',
  key: 'AAAAFA==',
  prevValue: 'AAAA…AAA=',
  durability: 'instance'
}
```

</td>
</tr>

<tr>
<td>
<code>contractEvent</code>
</td>
<td>InvokeHostFunctionOp</td>
<td>

```js
{
  type: 'contractEvent',
  source: 'GC3E…XMJY',
  contract: 'CCM3…OFJX',
  topics: [
    'mint',
    'GC3E…XMJY',
    'CDFD…ITT3',
    'AMDL:GC3E…XMJY'
  ],
  rawTopics: [
    'AAAA…aW50',
    'AAAA…gLs=',
    'AAAA…JA==',
    'AAAA…AAAA'
  ],
  data: '1000',
  rawData: 'AAAA…A+g='
}
```

</td>
</tr>

<tr>
<td>
<code>contractMetrics</code>
</td>
<td>InvokeHostFunctionOp</td>
<td>

```js
{
  type: 'contractMetrics',
  source: 'GC3E…XMJY',
  contract: 'CCM3…OFJX',
  cpu_insn: 25470499,
  emit_event: 5,
  emit_event_byte: 1176,
  invoke_time_nsecs: 2013675,
  ledger_read_byte: 36624,
  ledger_write_byte: 1028,
  max_emit_event_byte: 328,
  max_rw_code_byte: 16352,
  max_rw_data_byte: 924,
  max_rw_key_byte: 160,
  mem_byte: 10204502,
  read_code_byte: 33508,
  read_data_byte: 3116,
  read_entry: 16,
  read_key_byte: 1244,
  write_code_byte: 0,
  write_data_byte: 1028,
  write_entry: 5,
  write_key_byte: 0
}
```

</td>
</tr>

<tr>
<td>
<code>setTtl</code>
</td>
<td>ExtendFootprintTTLOp, RestoreFootprintOp</td>
<td>

```js
{
  type: 'setTtl',
  source: 'GC3E…XMJY',
  owner: 'CDAE…EH7T',
  kind: 'contractData',
  keyHash: '7594…b429',
  ttl: 2873856
}
```

</td>
</tr>

</table>