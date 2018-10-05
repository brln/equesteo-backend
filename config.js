export const AWS_SECRET_ACCESS_KEY = 'AWS_SECRET_ACCESS_KEY'
export const AWS_ACCESS_KEY_ID = 'AWS_ACCESS_KEY_ID'
export const COUCH_HOST = 'COUCH_HOST'
export const COUCH_PASSWORD = 'COUCH_PASSWORD'
export const COUCH_USERNAME = 'COUCH_USERNAME'
export const DYNAMODB_ENDPOINT = 'DYNAMODB_ENDPOINT'
export const ELASTICSEARCH_HOST = 'ELASTICSEARCH_HOST'
export const GCM_API_KEY = 'GCM_API_KEY'
export const NICOLE_USER_ID = 'NICOLE_USER_ID'
export const NODE_ENV = 'NODE_ENV'
export const SENDGRID_API_TOKEN = 'SENDGRID_API_TOKEN'
export const TOP_SECRET_JWT_TOKEN = 'TOP_SECRET_JWT_TOKEN'

const defaults = {
  AWS_SECRET_ACCESS_KEY: 'asdf',
  AWS_ACCESS_KEY_ID: 'qwer',
  COUCH_HOST: 'localhost:5984',
  COUCH_PASSWORD: 'equesteo',
  COUCH_USERNAME: 'equesteo',
  DYNAMODB_ENDPOINT: 'http://localhost:8000',
  ELASTICSEARCH_HOST: 'localhost:9200',
  GCM_API_KEY: 'summtin',
  NICOLE_USER_ID: '19e0763a558cfa107eeec280631b1cc1',
  NODE_ENV: 'local',
  PUSHER_KEY: 'dope',
  PUSHER_SECRET: 'fiend',
  SENDGRID_API_TOKEN: 'something,',
  TOP_SECRET_JWT_TOKEN: 'some super top secret token',
}

export function configGet (envVar) {
  let found = process.env[envVar]
  if (!found) {
    found = defaults[envVar]
  }
  return found
}