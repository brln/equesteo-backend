import aws from 'aws-sdk'
import {
  configGet,
  DYNAMODB_ENDPOINT,
  NODE_ENV
} from "../config"

export default class DynamoDBService {
  constructor () {
    this.ddb = new aws.DynamoDB()
    if (configGet(NODE_ENV) === 'local') {
      this.ddb.endpoint = configGet(DYNAMODB_ENDPOINT)
    } else {
      aws.config.update({region: 'us-west-1'});
    }

  }

  async deleteTable(tableName) {
    return new Promise((resolve, reject) => {
      this.ddb.deleteTable({TableName: tableName}, (err, data) => {
        if (err) {
          reject(err)
        } else {
          console.log('deleted table!')
          resolve(data)
        }
      })
    })
  }

   async createTable(keyName, keyType, tableName) {
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
          ReadCapacityUnits: 1,
          WriteCapacityUnits: 1
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

      console.log(params)

      this.ddb.putItem(params, function (err, data) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      });
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
