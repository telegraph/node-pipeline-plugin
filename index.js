
'use strict';

const AwsStack = require('./lib/aws-stack');

/**
 *
 * @param context {{command:String, appName:String, appEnv?:String, appVersion?:String}}
 */
exports.exec = function (context) {
    let command = context.command;
    let config  = {
        stackName   : context.appName.replace("-service", ""),
        stackEnv    : context.appEnv,
        stackVersion: context.appVersion
    };
    let stack   = new AwsStack(config, false);

    switch (command){
        case 'describe':
            stack.describe()
                .then(
                    result => {
                        console.info(JSON.stringify(result, null, 4));
                    },
                    error  => {
                        console.error(error)
                    }
                )
            ;
            break;
        case 'setup':
            stack.publish()
                .then( () => stack.describe()
                    .then ( () => stack.update() )
                    .catch( () => stack.create() )
                )
                .then( () => stack.await()  )
                .then(
                    () => {
                        console.info("Stack Set up successfully");
                    },
                    error  => {
                        console.error(error)
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
                    },
                    ()  => {
                        console.info("Stack Teared Down");
                    }
                );
            break;
        case 'publish':
            stack.publish()
                .then(
                    () => {
                        console.info("Stack Published successfully");
                    },
                    error  => {
                        console.error(error)
                    }
                );
            break;
    }
};

// let stack = ;
//
// stack.describe()
//     .then(
//         data => {
//             console.info(JSON.stringify(data, null, 4))
//         },
//         error => {
//             console.error(error)
//         }
//     );
