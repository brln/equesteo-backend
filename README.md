# To deploy:
cd frontend;
npm install;
npm run build;
eb deploy;


# Production Deploy Caveats!:
1. t2.small or larger or will run out of memory on `npm install`
2. Make sure npm version is latest.