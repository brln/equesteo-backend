# To deploy:
cd frontend;
npm install;
npm run build;
eb deploy;


# Production Deploy Caveats!:
1. t2.small or larger or will run out of memory on `npm install`
2. Make sure npm version is latest.


# Installing local elasticSearch:
Pre - install openSSH when installing ubuntu, forward port 4022, `ssh equesteo@localhost -p 4022`
1. `$ sudo add-apt-repository ppa:webupd8team/java`
2. `$ sudo apt-get update`
3. `$ sudo apt-get install oracle-java8-installer`
4. `$ curl -L -O https://artifacts.elastic.co/downloads/elasticsearch/elasticsearch-6.2.1.tar.gz`
5. `$ tar -xvf elasticsearch-6.2.1.tar.gz`
6. `$ cd elasticsearch-6.2.1/bin`
7. `$ sysctl -w vm.max_map_count=262144`
8. In your /etc/elasticsearch/elasticsearch.yml configuration file set network.host: 0.0.0.0
9. `$ ./elasticsearch`

# Installing production couchdb
1. Use Ubuntu 16 (1/7/18) because dependencies are broken on 18
2. Add "deb https://apache.bintray.com/couchdb-deb xenial main" to /etc/apt/sources.list 
3. `curl -L https://couchdb.apache.org/repo/bintray-pubkey.asc \
    | sudo apt-key add -`
4. `sudo apt-get update && sudo apt-get install couchdb`
