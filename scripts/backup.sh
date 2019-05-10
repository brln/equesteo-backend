#! /bin/bash

export AWS_CONFIG_FILE='/home/ubuntu/creds.aws'
FILENAME=`date '+%Y-%m-%d-%H:%M:%S'`.zip

sudo apt-get --assume-yes install zip;
sudo apt-get --assume-yes install awscli;
cd /opt/couchdb && sudo zip -r ${FILENAME} data;
aws s3 cp ${FILENAME} "s3://equesteo-zip-db-backups/${FILENAME}"