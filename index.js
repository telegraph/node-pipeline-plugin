
'use strict';

const AwsStack = require('./lib/aws-stack');

/**
 *
 * @param context {{command:String, appName:String, appEnv?:String, appVersion?:String, appRegion:String}}
 */
exports.exec = function (context) {
    let command = context.command;
    let config  = {
        stackName        : context.appName.replace("-service", ""),
        stackEnv         : context.appEnv,
        stackVersion     : context.appVersion,
        stackCustomParams: context.appParams,
        stackRegion      : context.appRegion
    };
    let stack   = new AwsStack(config, false);

    switch (command){
        case 'describe':
            stack.describe()
                .then(
                    result => {
                        console.info(JSON.stringify(result, null, 4));
                        process.exit(0)
                    },
                    error  => {
                        console.error(error);
                        process.exit(-1)
                    }
                )
            ;
            break;
        case 'setup':
            stack.publish()
                .then( () => stack.describe()
                    .then (
                        () => stack.update(),
                        () => stack.create()
                    )
                )
                .then( () => stack.await()  )
                .then(
                    () => {
                        console.info("Stack Set up successfully");
                        process.exit(0);
                    },
                    error  => {
                        console.error(error);
                        process.exit(-1);
                    }
                )
            ;
            break;
        case 'teardown':
            stack.describe()
                .then( () => stack.delete() )
                .then( () => stack.await()  )
                .then(
                    () => {
                        console.info("Stack Teared Down");
                        process.exit(0);
                    },
                    ()  => {
                        console.info("Stack Teared Down");
                        process.exit(0);
                    }
                );
            break;
        case 'publish':
            stack.publish()
                .then(
                    () => {
                        console.info("Stack Published successfully");
                        process.exit(0);
                    },
                    error  => {
                        console.error(error)
                        process.exit(-1);
                    }
                );
            break;
    }
};
