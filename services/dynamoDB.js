import aws from 'aws-sdk'
import {
  configGet,
  DYNAMODB_ENDPOINT,
  NODE_ENV
} from "../config"

export default class DynamoDBService {
  constructor (env=configGet(NODE_ENV)) {
    this.ddb = new aws.DynamoDB()
    this.ddbDocument = new aws.DynamoDB.DocumentClient();
    if (env === 'local') {
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
          console.log(err)
          reject()
        } else {
          console.log("Scan succeeded.");
          resolve(data.Items)
          // @TODO: implement this when the db is big enough to need it
          // continue scanning if we have more items
          // if (typeof data.LastEvaluatedKey != "undefined") {
          //   console.log("Scanning for more...");
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
