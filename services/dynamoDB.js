import aws from 'aws-sdk'
import {
  configGet,
  DYNAMODB_ENDPOINT,
  NODE_ENV
} from "../config"
import Logging from './Logging'

export default class DynamoDBService {
  constructor (env=configGet(NODE_ENV)) {
    let config
    if (env === 'local') {
      config = {endpoint: configGet(DYNAMODB_ENDPOINT)}
    } else {
      config = {region: 'us-west-1'}
    }
    this.ddb = new aws.DynamoDB(config)
    this.ddbDocument = new aws.DynamoDB.DocumentClient(config)
  }

  async deleteTable(tableName) {
    return new Promise((resolve, reject) => {
      this.ddb.deleteTable({TableName: tableName}, (err, data) => {
        if (err) {
          reject(err)
        } else {
          Logging.log('deleted table!')
          resolve(data)
        }
      })
    })
  }

   async createTable(keyName, keyType, tableName, readCapacity=1, writeCapacity=1) {
    return new Promise((resolve, reject) => {
      const params = {
        AttributeDefinitions: [
          {
            AttributeName: keyName,
            AttributeType: keyType
          },
        ],
        KeySchema: [
          {
            AttributeName: keyName,
            KeyType: 'HASH'
          },
        ],
        ProvisionedThroughput: {
          ReadCapacityUnits: readCapacity,
          WriteCapacityUnits: writeCapacity
        },
        TableName: tableName,
        StreamSpecification: {
          StreamEnabled: false
        }
      };

      this.ddb.createTable(params, function (err, data) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      });
    })
  }

  async putItem(tableName, item) {
    return new Promise((resolve, reject) => {
      const params = {
        TableName: tableName,
        Item: item
      }
      this.ddb.putItem(params, function (err, data) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      });
    })
  }

  async getAllItems (tableName) {
    return new Promise((resolve, reject) => {
      this.ddbDocument.scan({TableName: tableName}, (err, data) => {
        if (err) {
          Logging.log(err)
          reject()
        } else {
          Logging.log("Scan succeeded.");
          resolve(data.Items)
          // @TODO: implement this when the db is big enough to need it
          // continue scanning if we have more items
          // if (typeof data.LastEvaluatedKey != "undefined") {
          //   Logging.log("Scanning for more...");
          //   params.ExclusiveStartKey = data.LastEvaluatedKey;
          //   docClient.scan(params, onScan);
          // }
        }
      })
    })
  }

  async getItem(tableName, key) {
    return new Promise((resolve, reject) => {
      const params = {
        TableName: tableName,
        Key: key
      }

      // Call DynamoDB to read the item from the table
      this.ddb.getItem(params, function (err, data) {
        if (err) {
          reject(err)
        } else {
          resolve(data.Item)
        }
      });
    })
  }
}
