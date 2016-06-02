var assert = require('affirm.js')
var io     = require('socket.io-client')

module.exports = (function (socketUri, network, util, insight, socket) {
  var tuner              = {}
  var subscriptions      = {}
  var unconfirmedBalance = {}
  var bitcoinutil        = require("bitcoinutil")(network)
  var url                = socket ? undefined : socketUri
  socket                 = socket || io(url, { rejectUnauthorized: true })

  tuner.socket = socket

  tuner.subscribe = function (address, callback) {
    assert(Object.keys(subscriptions).length < 100, 'Too many addresses to watch, only 100 supported')
    assert(bitcoinutil.isValidBitcoinAddress(address), 'Not a valid bitcoin address ' + address)
    unconfirmedBalance[address] = true
    subscriptions[address]      = callback
  }

  tuner.unsubscribe = function (address) {
    delete subscriptions[address]
  }

  socket.on('connect', function () {
    console.log('Connected to insight websocket', url)
    socket.emit('subscribe', 'inv')
  })

  socket.on('tx', callbackUnconfirmedTx)
  socket.on('block', callbackConfirmedTx)

  function callbackUnconfirmedTx(data) {
    var match = false
    for (var address in subscriptions) {
      if (isMatch(address, data)) {
        match = unconfirmedBalance[address] = true
      }
    }
    if (match) {
      addUnconfirmedInputs(data.txid).then(getBalances)
    }
  }

  function isMatch(address, data) {
    for (var i = 0; i < data.vout.length; i++) {
      if (data.vout[i][address]) return true
    }
    return false
  }

  function callbackConfirmedTx(block) {
    getBalances(Object.keys(unconfirmedBalance))
  }

  function getBalances(addresses) {
    if (!addresses || addresses.length === 0) return
    insight.multi(insight.getAddress, addresses)
      .then(function (results) {
        for (var i = 0; results && i < results.length; i++) {
          var addressInfo = results[i]
          if (addressInfo.unconfirmed == 0) {
            delete unconfirmedBalance[addressInfo.address]
          }
          var subscriptionFunction = subscriptions[addressInfo.address]
          if (subscriptionFunction) subscriptionFunction(addressInfo)
        }
      })
  }

  function addUnconfirmedInputs(txid) {
    return insight.getTransaction(txid)
      .then(function (tx) {
        for (var i = 0; i < tx.vin.length; i++) {
          inputAddress = tx.vin[i].addr
          if (subscriptions[inputAddress]) unconfirmedBalance[inputAddress] = true
        }
        return Object.keys(unconfirmedBalance)
      })
  }

  return tuner
})
