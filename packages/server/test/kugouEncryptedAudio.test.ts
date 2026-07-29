import assert from 'node:assert/strict'
import test from 'node:test'
import { createKugouQmcCipher, deriveKugouQmcKey } from '../src/services/kugouEncryptedAudio.js'

// Public QMC2 test vectors from um/cli. Only the encrypted key envelopes are
// retained here; the audio fixtures are not copied into this repository.
const MAP_EKEY =
  'eXc3eFdPeU6+3f7GVeF35bMpIEIQj5JWOWt7G+jsR68Hx3BUFBavkTQ8dpPdP0XBIwPe+OfdsnTGVQqPyg3GCtQSrkgA0mwSQdr4DPzKLkEZFX+Cf1V6ChyipOuC6KT37eAxWMdV1UHf9/OCvydr1dc6SWK1ijRUcP6IAHQhiB+mZLay7XXrSPo32WjdBkn9c9sa2SLtI48atj5kfZ4oOq6QGeld2JA3Z+3wwCe6uTHthKaEHY8ufDYodEe3qqrjYpzkdx55pCtxCQa1JiNqFmJigWm4m3CDzhuJ7YqnjbD+mXxLi7BP1+z4L6nccE2h+DGHVqpGjR9+4LBpe4WHB4DrAzVp2qQRRQJxeHd1v88='
const RC4_EKEY =
  'cFV0eXZxcjAF/IXJ9qJT1u5C3S5AgY9BoVtIQNBKfxQMt5hH7BF36ndIJGV5L6qw5h4G0IOIOOewdHmMCNfKJftHM4nv3B0iRlSdqJKdL08wO3sV0v8eZk0OiYAlxgseGcBquQWYS/0b5Lj/Ioi2NfpOthAY9vUiRPnfH3+7/2AJGudHjj4Gg1KkpPW3mXIKbsk+Ou9fhrUqs873BCdsmI6qRmVNhOkLaUcbG6Zin3XU0WkgnnjebR43S8N4bw5BTphFvhy42QvspnD7Ewb1tVZQMQ2N1s38nBjukdfCB9R6aRwITOvg2U7Lr0RjLpbrIn6A6iVilpINjK4VptuKUTlpDXQwgCjoqeHQaHNCWgYpdjB69lXn8km/BfzK7QyDbh0VgTikwAHF9tvPhin3AIDRcU0xsaWYKURRfJelX3pSN495ADlhXdEKL/+l60hVnY7t6iCMxJL3lOtdGtdUYUGUCc76PB1fX+0HTWCcfcwvXTEdczr9J1h2yTeJNqFQ5pNy8vX7Ws8k7vDQVFkw4llZjPhb0kg9aDNePTNIKSGwy/7eofrcUQlC9DI+qqqwQ5abA/93fNsPq6XU3uwawnrbBsdz8DDdjJiEDI7abkPIDIfr/uR0YzgBxW90t5bt6xAtuW+VSYAM7kGxI3RZTl7JgOT60MLyIWkYASrRhRPMGks8zL10ED/4yGTEB1nt'

for (const [name, ekey, keyLength] of [
  ['MAP', MAP_EKEY, 256],
  ['RC4', RC4_EKEY, 512],
] as const) {
  test(`derives the public QMC2 ${name} key and decrypts a non-zero range`, () => {
    assert.equal(deriveKugouQmcKey(ekey).length, keyLength)

    const plain = Buffer.allocUnsafe(24_000)
    for (let index = 0; index < plain.length; index += 1) plain[index] = (index * 29 + 17) & 0xff

    const encrypted = Buffer.from(plain)
    createKugouQmcCipher(ekey).decrypt(encrypted, 0)

    const start = 6_137
    const decryptedRange = Buffer.from(encrypted.subarray(start, 18_731))
    createKugouQmcCipher(ekey).decrypt(decryptedRange, start)
    assert.deepEqual(decryptedRange, plain.subarray(start, 18_731))
  })
}

test('rejects an unverified tracker ekey envelope', () => {
  assert.throws(() => deriveKugouQmcKey(Buffer.alloc(368, 0x41).toString('base64')), /Invalid QMC/)
})
