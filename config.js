export const COUCH_HOST = 'COUCH_HOST'
export const COUCH_PASSWORD = 'COUCH_PASSWORD'
export const COUCH_USERNAME = 'COUCH_USERNAME'
export const TOP_SECRET_JWT_TOKEN = 'TOP_SECRET_JWT_TOKEN'

const defaults = {
  COUCH_HOST: 'localhost:15984',
  COUCH_PASSWORD: 'equesteo',
  COUCH_USERNAME: 'equesteo',
  TOP_SECRET_JWT_TOKEN: 'some super top secret token',
}

export function configGet (envVar) {
  let found = process.env[envVar]
  if (!found) {
    found = defaults[envVar]
  }
  return found

}