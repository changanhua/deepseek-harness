// Observe the real CLI listener, without waiting for its settled URL announcement.
import { Server } from 'node:net'
const listen = Server.prototype.listen
Server.prototype.listen = function (...args) {
  this.once('listening', () => {
    const address = this.address()
    if (address && typeof address !== 'string') process.send?.({ port: address.port })
  })
  return listen.apply(this, args)
}
