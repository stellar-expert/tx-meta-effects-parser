# @stellar-expert/tx-meta-effects-parser

> Low-level effects parser for Stellar transaction results and meta XDR

Some [Stellar](https://stellar.org) operations yield non-deterministic results,
so developers often have to pull the data from Horizon `/effects` API endpoints.
This package provides the ability to retrieve atomic ledger state modifications
directly from the transaction execution result and metadata.

## Installation

```
npm i github:@stellar-expert/tx-meta-effects-parser
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
<th>Effect</th> <th>Yielded by</th> <th>Description</th> <th>Example</th>
</tr>

<tr>
<td>
<code>feeCharged</code>
</td>
<td>Transaction, FeeBumpTransaction</td>
<td>Transaction fee charged from the source account</td>
<td>

js
{
  type: 'feeCharged',
  source: 'GBKP…YDLI',
  asset: 'XLM',
  feeBid: '10000',
  charged: '400'
}
</td>
</tr>

<tr>
<td>
<code>accountCreated</code>
</td>
<td>CreateAccountOp</td>
<td>New account created on the ledger</td>
<td>

js
{
  type: 'accountCreated',
  source: 'GBKP…YDLI',
  account: 'GBWC…DXHN'
}
</td>
</tr>

<tr>
<td>
<code>accountRemoved</code>
</td>
<td>AccountMergeOp</td>
<td>Account deleted from the ledger</td>
<td>

js
{
    type: 'accountRemoved',
    account: 'GBWC…DXHN'
}
</td>
</tr>

<tr>
<td>
<code>accountDebited</code>
</td>
<td>CreateAccountOp, AccountMergeOp, PaymentOp, PathPaymentStrictReceiveOp,
PathPaymentStrictSendOp, CreateClaimableBalanceOp, ClawbackOp</td>
<td>Funds deducted from the account</td>
<td>

js
{
  type: 'accountDebited',
  source: 'GBKP…YDLI',
  asset: 'XLM',
  amount: '100.0000000'
}
</td>
</tr>

<tr>
<td>
<code>accountCredited</code>
</td>
<td>CreateAccountOp, AccountMergeOp, PaymentOp, PathPaymentStrictReceiveOp,
PathPaymentStrictSendOp, ClaimClaimableBalanceOp, ClawbackOp, 
ClawbackClaimableBalance, InflationOp</td>
<td>Funds transferred to the account</td>
<td>

js
{
    type: 'accountCredited',
    source: 'GBWC…DXHN',
    asset: 'XLM',
    amount: '100.0000000'
}
</td>
</tr>

<tr>
<td>
<code>accountHomeDomainUpdated</code>
</td>
<td>SetOptionsOp</td>
<td>Account home domain updated</td>
<td>

js
{
  type: 'accountHomeDomainUpdated',
  source: 'GBWC…DXHN',
  domain: 'example.com'
}
</td>
</tr>

<tr>
<td>
<code>accountThresholdsUpdated</code>
</td>
<td>SetOptionsOp</td>
<td>Account operation thresholds updated</td>
<td>

js
{
  type: 'accountThresholdsUpdated',
  source: 'GBWC…DXHN',
  thresholds: [1,1,3]
}
</td>
</tr>

<tr>
<td>
<code>accountFlagsUpdated</code>
</td>
<td>SetOptionsOp</td>
<td>Account asset issuing flags updated</td>
<td>

js
{
  type: 'accountFlagsUpdated',
  source: 'GBWC…DXHN',
  flags: 2
}
</td>
</tr>

<tr>
<td>
<code>accountInflationDestinationUpdated</code>
</td>
<td>SetOptionsOp</td>
<td>Account inflation destination updated</td>
<td>

js
{
  type: 'accountInflationDestinationUpdated',
  source: 'GBWC…DXHN',
  inflationDestination: 'GBKP…YDLI'
}
</td>
</tr>

<tr>
<td>
<code>accountSignerCreated</code>
</td>
<td>SetOptionsOp</td>
<td>Account signer created</td>
<td>

js 
{
    type: 'accountSignerCreated',
    source: 'GBWC…DXHN',
    signer: 'GBKP…YDLI',
    weight: 1,
    masterWeight: 1,
    signers: [
        {key: 'GBWC…DXHN', weight: 1},
        {key: 'GBKP…YDLI', weight: 1}
    ]
}

</td>
</tr>

<tr>
<td>
<code>accountSignerUpdated</code>
</td>
<td>SetOptionsOp</td>
<td>Account signer updated</td>
<td>

js 
{
  type: 'accountSignerCreated',
    source: 'GBWC…DXHN',
    signer: 'GBKP…YDLI',
    weight: 2,
    masterWeight: 1,
    signers: [
        {key: 'GBWC…DXHN', weight: 2},
        {key: 'GBKP…YDLI', weight: 1}
    ]
}

</td>
</tr>

<tr>
<td>
<code>accountSignerRemoved</code>
</td>
<td>SetOptionsOp</td>
<td>Account signer removed</td>
<td>

js
{
  type: 'accountSignerRemoved',
  source: 'GBWC…DXHN',
  weight: 0,
  masterWeight: 1,
  signers: [
      {key: 'GBWC…DXHN', weight: 1}
  ]
}

</td>
</tr>

<tr>
<td>
<code>trustlineCreated</code>
</td>
<td>ChangeTrustOp</td>
<td>Trustline created for the account</td>
<td>

js
{
  type: 'trustlineCreated',
  source: 'GBWC…DXHN',
  asset: 'USD:GBKP…YDLI',
  limit: '100.0000000'
}

</td>
</tr>

<tr>
<td>
<code>trustlineUpdated</code>
</td>
<td>ChangeTrustOp, AllowTrustOp</td>
<td>Trustline updated for the account</td>
<td>

js
{
  type: 'trustlineUpdated',
  source: 'GBWC…DXHN',
  asset: 'USD:GBKP…YDLI',
  limit: '200.0000000'
}

</td>
</tr>

<tr>
<td>
<code>trustlineRemoved</code>
</td>
<td>ChangeTrustOp</td>
<td>Trustline removed from the account</td>
<td>

js
{
  type: 'trustlineRemoved',
  source: 'GBWC…DXHN',
  asset: 'USD:GBKP…YDLI'
}

</td>
</tr>

<tr>
<td>
<code>liquidityPoolCreated</code>
</td>
<td>ChangeTrustOp</td>
<td>Liquidity pool created</td>
<td>

js  
{
  type: 'liquidityPoolCreated',
  source:  'GBWC…DXHN',
  pool:  '52a8...76f8',
  reserves: [
    {
      asset: 'XLM',
      amount: '0'
    },
    {
      asset: 'USD:GBKP…YDLI',
      amount: '0'
    }
  ],
  shares: '0'
}

</td>
</tr>

<tr>
<td>
<code>liquidityPoolUpdated</code>
</td>
<td>DepositLiquidityOp, WithdrawLiquidityOp</td>
<td>Liquidity pool updated</td>
<td>

js  
{
  type: 'liquidityPoolUpdated',
  source: 'GBWC…DXHN',
  pool: '52a8...76f8',
  reserves: [
    {
      asset: 'XLM',
      amount: '1000'
    },
    {
      asset: 'USD:GBKP…YDLI',
      amount: '1000'
    }
  ],
  shares: '10000000000'
}

</td>
</tr>

<tr>
<td>
<code>liquidityPoolDeposited</code>
</td>
<td>DepositLiquidityOp</td>
<td>Liquidity pool deposited</td>
<td>

js  
{
  type: 'liquidityPoolDeposited',
  source: 'GBWC…DXHN',
  pool: '52a8...76f8',
  reserves: [
    {
      asset: 'XLM',
      amount: '1000'
    },
    {
      asset: 'USD:GBKP…YDLI',
      amount: '1000'
    }
  ],
  shares: '10000000000'
}

</td>
</tr>

<tr>
<td>
<code>liquidityPoolWithdrew</code>
</td>
<td>WithdrawLiquidityOp</td>
<td>Liquidity pool withdrew</td>
<td>

js  
{
  type: 'liquidityPoolWithdrew',
  source: 'GBWC…DXHN',
  pool: '52a8...76f8',
  reserves: [
    {
      asset: 'XLM',
      amount: '1000'
    },
    {
      asset: 'USD:GBKP…YDLI',
      amount: '1000'
    }
  ],
  shares: '10000000000'
}

</td>
</tr>

<tr>
<td>
<code>liquidityPoolRemoved</code>
</td>
<td>ChangeTrustOp</td>
<td>Liquidity pool removed</td>
<td>

js  
{
  type: 'liquidityPoolRemoved',
  source: 'GBWC…DXHN',
  pool: '52a8...76f8'
}

</td>
</tr>

<tr>
<td>
<code>trustlineAuthorizationUpdated</code>
</td>
<td>AllowTrustOp</td>
<td>Trustline authorization updated</td>
<td>

js
{
  type: 'trustlineAuthorizationUpdated',
  source: 'GBWC…DXHN',
  trustor: 'GBKP…YDLI',
  asset: 'USD:GBWC…DXHN',
  authorize: 5
}

</td>
</tr>

<tr>
<td>
<code>trustlineDeauthorized</code>
</td>
<td>AllowTrustOp</td>
<td>Trustline deauthorized</td>
<td>

js
{
  type: 'trustlineDeauthorized',
  source: 'GBWC…DXHN',
  trustor: 'GBKP…YDLI',
  asset: 'USD:GBWC…DXHN',
  authorize: 4
}

</td>
</tr>

<tr>
<td>
<code>offerCreated</code>
</td>
<td>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp</td>
<td>Offer created</td>
<td>

js
{
  type: 'offerCreated',
  source: 'GBWC…DXHN',
  owner: 'GBWC…DXHN',
  offer: '1',
  amount: '100',
  asset: [
    'USD:GBKP…YDLI',
    'XLM'
    ],
  price: 1
  flags: 0
}

</td>
</tr>

<tr>
<td>
<code>offerUpdated</code>
</td>
<td>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp, PathPaymentOp</td>
<td>Offer updated</td>
<td>

js
{
  type: 'offerUpdated',
  source: 'GBWC…DXHN',
  owner: 'GBWC…DXHN',
  offer: '1',
  amount: '90',
  asset: [
    'USD:GBKP…YDLI',
    'XLM'
    ],
  price: 1
  flags: 0
}

</td>
</tr>

<tr>
<td>
<code>trade</code>
</td>
<td>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp, PathPaymentOp</td>
<td>Trade</td>
<td>

js
{
  type: 'trade',
  source: 'GBWC…DXHN',
  offer: '1',
  amount: ['10', '10'],
  asset: [
    'USD:GBKP…YDLI',
    'XLM'
  ],
  seller: 'GBKP…YDLI'
}

</td>
</tr>

<tr>
<td>
<code>offerRemoved</code>
</td>
<td>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp, PathPaymentOp</td>
<td>Offer removed</td>
<td>

js
{
  type: 'offerRemoved',
  source: 'GBWC…DXHN',
  owner: 'GBWC…DXHN',
  offer: '1',
  asset: [
    'USD:GBKP…YDLI',
    'XLM'
  ],
  flags: 1
}
</td>
</tr>


<tr>
<td>
<code>inflation</code>
</td>
<td>InflationOp</td>
<td>Inflation</td>
<td>

js
{
  type: 'inflation',
  source: 'GBWC…DXHN',
  asset: 'XLM',
  amount: '1000000000'
}

</td>
</tr>


<tr>
<td>
<code>dataEntryCreated</code>
</td>
<td>ManageDataOp</td>
<td>Data entry created</td>
<td>

js
{
  type: 'dataEntryCreated',
  source: 'GBWC…DXHN',
  name: 'test',
  value: 'dGVzdA=='
}

</td>
</tr>

<tr>
<td>
<code>dataEntryUpdated</code>
</td>
<td>ManageDataOp</td>
<td>Data entry updated</td>
<td>

js
{
  type: 'dataEntryUpdated',
  source: 'GBWC…DXHN',
  name: 'test',
  value: 'dGVzVA=='
}

</td>
</tr>

<tr>
<td>
<code>dataEntryRemoved</code>
</td>
<td>ManageDataOp</td>
<td>Data entry removed</td>
<td>

js
{
  type: 'dataEntryRemoved',
  source: 'GBWC…DXHN',
  name: 'test'
}

</td>
</tr>

<tr>
<td>
<code>sequenceBumped</code>
</td>
<td>BumpSequenceOp</td>
<td>Sequence bumped</td>
<td>

js
{
  type: 'sequenceBumped',
  source: 'GBWC…DXHN',
  sequence: '100'
}

</td>
</tr>

<tr>
<td>
<code>claimableBalanceCreated</code>
</td>
<td>CreateClaimableBalanceOp</td>
<td>Claimable balance created</td>
<td>

js
{
  type: 'claimableBalanceCreated',
  source: 'GBWC…DXHN',
  balance: '7aba...6f9d',
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

</td>
</tr>

<tr>
<td>
<code>claimableBalanceRemoved</code>
</td>
<td>ClaimClaimableBalanceOp</td>
<td>Claimable balance removed</td>
<td>

js
{
  type: 'claimableBalanceRemoved',
  source: 'GBWC…DXHN',
  balance: '7aba...6f9d'
}

</td>
</tr>

<tr>
<td>
<code>accountSponsorshipCreated</code>
</td>
<td>CreateAccountOp</td>
<td>Account sponsorship created</td>
<td>

js
{
  type: 'accountSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI'
}

</td>
</tr>

<tr>
<td>
<code>accountSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Account sponsorship updated</td>
<td>

js
{
  type: 'accountSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI'
}

</td>
</tr>

<tr>
<td>
<code>accountSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Account sponsorship removed</td>
<td>

js
{
  type: 'accountSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI'
}

</td>
</tr>

<tr>
<td>
<code>trustlineSponsorshipCreated</code>
</td>
<td>ChangeThrustOp</td>
<td>Trustline sponsorship created</td>
<td>

js
{
  type: 'trustlineSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  asset: 'USD:GBKP…YDLI'
}

</td>
</tr>

<tr>
<td>
<code>trustlineSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Trustline sponsorship updated</td>
<td>

js
{
  type: 'trustlineSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  asset: 'USD:GBKP…YDLI'
}

</td>
</tr>

<tr>
<td>
<code>trustlineSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Trustline sponsorship removed</td>
<td>

js
{
  type: 'trustlineSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  asset: 'USD:GBKP…YDLI'
}

</td>
</tr>

<tr>
<td>
<code>liquidityPoolStakeSponsorshipCreated</code>
</td>
<td>ChangeThrustOp</td>
<td>Liquidity pool stake sponsorship created</td>
<td>

js
{
  type: 'liquidityPoolStakeSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  pool: '7aba...6f9d'
}

</td>
</tr>

<tr>
<td>
<code>liquidityPoolStakeSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Liquidity pool stake sponsorship updated</td>
<td>

js
{
  type: 'liquidityPoolStakeSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  pool: '7aba...6f9d'
}

</td>
</tr>

<tr>
<td>
<code>liquidityPoolStakeSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Liquidity pool stake sponsorship removed</td>
<td>

js
{
  type: 'liquidityPoolStakeSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  pool: '7aba...6f9d'
}

</td>
</tr>

<tr>
<td>
<code>offerSponsorshipCreated</code>
</td>
<td>CreatePassiveOfferOp, ManageBuyOfferOp, ManageSellOfferOp</td>
<td>Offer sponsorship created</td>
<td>

js
{
  type: 'offerSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  offer: '100'
}

</td>
</tr>

<tr>
<td>
<code>offerSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Offer sponsorship updated</td>
<td>

js
{
  type: 'offerSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  offer: '100'
}

</td>
</tr>

<tr>
<td>
<code>offerSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Offer sponsorship removed</td>
<td>

js
{
  type: 'offerSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  offer: '100'
}

</td>
</tr>

<tr>
<td>
<code>dataSponsorshipCreated</code>
</td>
<td>CreateDataEntryOp</td>
<td>Data sponsorship created</td>
<td>

js
{
  type: 'dataSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  name: 'name'
}

</td>
</tr>

<tr>
<td>
<code>dataSponsorshipUpdated</code> 
</td>
<td>RevokeSponsorshipOp</td>
<td>Data sponsorship updated</td>
<td>

js
{
  type: 'dataSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  name: 'name'
}

</td>
</tr>

<tr>
<td>
<code>dataSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Data sponsorship removed</td>
<td>

js
{
  type: 'dataSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  account: 'GBKP…YDLI',
  name: 'name'
}

</td>
</tr>

<tr>
<td>
<code>claimableBalanceSponsorshipCreated</code>
</td>
<td>CreateClaimableBalanceOp</td>
<td>Claimable balance sponsorship created</td>
<td>

js
{
  type: 'claimableBalanceSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d'
}

</td>
</tr>

<tr>
<td>
<code>claimableBalanceSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Claimable balance sponsorship updated</td>
<td>

js
{
  type: 'claimableBalanceSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d'
}

</td>
</tr>

<tr>
<td>
<code>claimableBalanceSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Claimable balance sponsorship removed</td>
<td>

js
{
  type: 'claimableBalanceSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  balance: '7aba…6f9d'
}

</td>
</tr>

<tr>
<td>
<code>signerSponsorshipCreated</code>
</td>
<td>SetOptionsOp</td>
<td>Signer sponsorship created</td>
<td>

js
{
  type: 'signerSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN',
  signer: 'GALF…CR2V'
  account: 'GBKP…YDLI'
}

</td>
</tr>

<tr>
<td>
<code>signerSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Signer sponsorship updated</td>
<td>

js 
{
  type: 'signerSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN',
  signer: 'GALF…CR2V'
  account: 'GBKP…YDLI'
}

</td>
</tr>

<tr>
<td>
<code>signerSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Signer sponsorship removed</td>
<td>

js
{
  type: 'signerSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN',
  signer: 'GALF…CR2V'
  account: 'GBKP…YDLI'
}

</td>
</tr>

<tr>
<td>
<code>liquidityPoolSponsorshipCreated</code>
</td>
<td>ChangeThrustOp</td>
<td>Liquidity pool sponsorship created</td>
<td>

js
{
  type: 'liquidityPoolSponsorshipCreated',
  source: 'GBWC…DXHN',
  sponsor: 'GBWC…DXHN'
}

</td>
</tr>

<tr>
<td>
<code>liquidityPoolSponsorshipUpdated</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Liquidity pool sponsorship updated</td>
<td>

js
{
  type: 'liquidityPoolSponsorshipUpdated',
  source: 'GBWC…DXHN',
  sponsor: 'GDNP…CMXH',
  prevSponsor: 'GBWC…DXHN'
}

</td>
</tr>

<tr>
<td>
<code>liquidityPoolSponsorshipRemoved</code>
</td>
<td>RevokeSponsorshipOp</td>
<td>Liquidity pool sponsorship removed</td>
<td>

js
{
  type: 'liquidityPoolSponsorshipRemoved',
  source: 'GBWC…DXHN',
  prevSponsor: 'GBWC…DXHN'
}

</td>
</tr>

</table>