export const AWS_SECRET_ACCESS_KEY = 'AWS_SECRET_ACCESS_KEY'
export const AWS_ACCESS_KEY_ID = 'AWS_ACCESS_KEY_ID'
export const COUCH_HOST = 'COUCH_HOST'
export const COUCH_PASSWORD = 'COUCH_PASSWORD'
export const COUCH_USERNAME = 'COUCH_USERNAME'
export const PUSHER_KEY = 'PUSHER_KEY'
export const PUSHER_SECRET = 'PUSHER_SECRET'
export const TOP_SECRET_JWT_TOKEN = 'TOP_SECRET_JWT_TOKEN'

const defaults = {
  AWS_SECRET_ACCESS_KEY: 'asdf',
  AWS_ACCESS_KEY_ID: 'qwer',
  COUCH_HOST: 'localhost:15984',
  COUCH_PASSWORD: 'equesteo',
  COUCH_USERNAME: 'equesteo',
  PUSHER_KEY: 'dope',
  PUSHER_SECRET: 'fiend',
  TOP_SECRET_JWT_TOKEN: 'some super top secret token',
}

export function configGet (envVar) {
  let found = process.env[envVar]
  if (!found) {
    found = defaults[envVar]
  }
  return found

}