
const AWS        = require('aws-sdk');
const _          = require('lodash');
const Dir        = require('recursive-readdir');
const Fs         = require('fs');
const ExecDir = process.cwd();

const DefaultConfig = {
    stackEnv           : undefined,
    stackName          : undefined,
    stackVersion       : undefined,
    stackTemplateType  : undefined, //!Pipeline.stackEnv ? "static" : "dynamic", /*can ether be static or dynamic*/
    stackParamsPath    : undefined, //`infrastructure/${Pipeline.stackTemplatePath}/parameters`,
    stackTemplatePath  : undefined, //`infrastructure/${Pipeline.stackTemplatePath}/templates`,
    stackSkip          : false,
    stackCustomParams  : {
        // "BuildVersion": Pipeline.stackVersion
    },
    stackTags          : [
        {Key:"Billing", Value:"Platforms"}
    ],
    stackCapabilities  : [
        "CAPABILITY_IAM",
        "CAPABILITY_NAMED_IAM"
    ],
    stackRegion        : "eu-west-1",
    stackAuth          : {
        type   : "Profile",
        profile: undefined //Pipeline.stackEnv === "static" || Pipeline.stackEnv === "prod" ? "prod" : "preprod"
    },
    stackTemplateFormat: undefined,
    stackTemplateS3Uri : undefined//`s3://artifacts-repo/${Pipeline.stackName}/${Pipeline.stackVersion}/cloudformation/${Pipeline.stackTemplateType}`
};

function logOperation(operation, stackConfig, params){

    console.info(``);
    console.info(`${operation} Stack:`);
    console.info(``);
    console.info(`\t Environment: ${stackConfig.stackEnv}`);
    if(stackConfig.stackAuth.type === 'Profile' ){
        console.info(`\t Credentials: Profile('${stackConfig.stackAuth.profile}')`);
    }
    console.info(`\t      Region: ${stackConfig.stackRegion}`);
    console.info(`\t        Path: ${stackConfig.stackPath}`);
    console.info(`\t      S3 Uri: ${stackConfig.stackTemplateS3Uri}`);
    console.info(`\t        Name: ${stackConfig.stackName}-${stackConfig.stackEnv}`);


    if( params ){
        console.info(`\tCapabilities: ${stackConfig.stackCapabilities}`);
        console.info(`\t        Tags: ${JSON.stringify(stackConfig.stackTags)}`);
        console.info(`\t  Parameters: ${JSON.stringify(stackConfig.stackCustomParams)}`);
        console.info(`\tTemplate Uri: ${stackConfig.stackTemplateS3Uri}/templates/template.json`);
    }
    console.info(``);
}

function validateStackConfig(stackConfig, validate){
    let errors = [];

    if( validate && !_.get(stackConfig, 'stackEnv') ){
        errors.push("Missing 'stackEnv' value")
    }
    if( validate && !_.get(stackConfig, 'stackName') ){
        errors.push("Missing 'stackName' value")
    }
    if( validate && !_.get(stackConfig, 'stackVersion') ){
        errors.push("Missing 'stackVersion' value")
    }

    // Set stackTemplateType, stackParamsPath, stackTemplatePath
    stackConfig.stackTemplateType = stackConfig.stackTemplateType || !stackConfig.stackEnv ? "static" : "dynamic";
    stackConfig.stackPath         = stackConfig.stackPath         || `${ExecDir}/infrastructure/${stackConfig.stackTemplateType}`;
    stackConfig.stackParamsPath   = stackConfig.stackParamsPath   || `${stackConfig.stackPath}/parameters`;
    stackConfig.stackTemplatePath = stackConfig.stackTemplatePath || `${stackConfig.stackPath}/templates`;

    // Set CustomParams
    stackConfig.stackCustomParams = Object.entries(_.defaultsDeep({}, stackConfig.stackCustomParams, {"BuildVersion": stackConfig.stackVersion}))
        .map( ([key, value]) => ({
            ParameterKey  : key,
            ParameterValue: value
        }))
    ;

    // Set Default stackAuth
    if( _.get(stackConfig, 'stackAuth.type') === "Profile" ){
        stackConfig.stackAuth.profile = stackConfig.stackAuth.profile || (stackConfig.stackEnv === "static" || stackConfig.stackEnv === "prod" ? "prod" : "preprod")
    }else {
        errors.push(`Authentication type not supported '${_.get(stackConfig, 'stackAuth.type')}'`)
    }

    // Set Default stackTemplateS3Uri
    if( !_.get(stackConfig, 'stackTemplateS3Uri') ){
        stackConfig.stackTemplateS3Uri = stackConfig.stackTemplateS3Uri || `s3://artifacts-repo/${stackConfig.stackName}/${stackConfig.stackVersion}/cloudformation/${stackConfig.stackTemplateType}`
    }
    return errors;
}

function prepareParameters(stackConfig){
    let localParams = require(`${stackConfig.stackParamsPath}/parameters-${stackConfig.stackEnv}.json`) || [];
    let stackParams = localParams
        .filter( item => !stackConfig.stackCustomParams.some( _ => _.ParameterKey === item.ParameterKey ))
        .concat(stackConfig.stackCustomParams)
    ;

    if( !stackParams.includes( item => item.ParameterKey === "ApplicationName" )){
        stackParams.push({ParameterKey: "ApplicationName", ParameterValue: stackConfig.stackName});
    }
    if( !stackParams.includes( item => item.ParameterKey === "DeploymentEnv" )){
        stackParams.push({ParameterKey: "DeploymentEnv", ParameterValue: stackConfig.stackEnv});
    }
    return stackParams;
}

function fromS3UriToS3Url(stackTemplateS3Uri, stackRegion){
    return stackTemplateS3Uri.replace("s3://",`https://s3-${stackRegion}.amazonaws.com/`)
}

class AwsStack {

    constructor(stackConfig, validate = true){
        let errors;

        this._stackConfig = _.defaultsDeep({}, stackConfig, DefaultConfig);

        errors = validateStackConfig(this._stackConfig, validate);
        if( (errors || []).length > 0 ){
            throw new Error(`Invalid Stack Configuration:\n\t${errors.join("\n\t")}`);
        }
        // Configure AWS
        AWS.config.credentials = new AWS.SharedIniFileCredentials({
            profile: this._stackConfig.stackAuth.profile
        });
        AWS.config.region = this._stackConfig.stackRegion;

        this._awsCf  = new AWS.CloudFormation();
        this._awsS3  = new AWS.S3();
    }

    describe(){
        return new Promise((resolve, reject) => {
            let request = {
                StackName: `${this._stackConfig.stackName}-${this._stackConfig.stackEnv}`
            };
            this._awsCf.describeStacks(request, (error, response) => {
                if( error ){
                    return reject(error)
                }
                if( (response.Stacks || []).length === 0 ){
                    return reject(new Error("No Stack found."));
                }
                resolve(response.Stacks);
            });
        });
    }

    await(){
        return new Promise((resolve, reject) => {
            let request = {
                StackName: `${this._stackConfig.stackName}-${this._stackConfig.stackEnv}`
            };

            console.info("Waiting for status:");
            let interval = setInterval(() => {
                this._awsCf.describeStacks(request, (error, response) => {
                    if( error ){
                        clearInterval(interval);
                        return reject(error)
                    }
                    console.info(`   ${response.Stacks[0].StackStatus}`);
                    if( response.Stacks[0].StackStatus.endsWith('COMPLETE') ){
                        clearInterval(interval);
                        return resolve(response.Stacks[0])
                    }
                });
            }, 2000);
        });
    }

    create(){
        let params;
        try{
            params = prepareParameters(this._stackConfig);
        }catch(e){
            return Promise.reject(`No parameters found for environment ${this._stackConfig.stackEnv} at '${this._stackConfig.stackParamsPath}'. The parameter file should follow the pattern 'parameters-{AppEnv}.json'`)
        }

        logOperation('Create', this._stackConfig, params);
        return new Promise((resolve, reject) => {
            let request = {
                StackName   : `${this._stackConfig.stackName}-${this._stackConfig.stackEnv}`,
                Capabilities: this._stackConfig.stackCapabilities,
                Parameters  : params,
                Tags        : this._stackConfig.stackTags,
                TemplateURL : fromS3UriToS3Url(`${this._stackConfig.stackTemplateS3Uri}/templates/template.json`, this._stackConfig.stackRegion)
            };

            this._awsCf.createStack(request, (error) => {
                error ? reject(error) : resolve();
            })
        });
    }

    update(){
        let params;
        try{
            params = prepareParameters(this._stackConfig);
        }catch(e){
            return Promise.reject(`No parameters found for environment ${this._stackConfig.stackEnv} at '${this._stackConfig.stackParamsPath}'. The parameter file should follow the pattern 'parameters-{AppEnv}.json'`)
        }

        logOperation('Update', this._stackConfig, params);
        return new Promise((resolve, reject) => {
            let request = {
                StackName   : `${this._stackConfig.stackName}-${this._stackConfig.stackEnv}`,
                Capabilities: this._stackConfig.stackCapabilities,
                Parameters  : params,
                Tags        : this._stackConfig.stackTags,
                TemplateURL : fromS3UriToS3Url(`${this._stackConfig.stackTemplateS3Uri}/templates/template.json`, this._stackConfig.stackRegion)
            };

            this._awsCf.updateStack(request, (error) => {
                error ? reject(error) : resolve();
            })
        });
    }

    delete(){
        return new Promise((resolve, reject) => {
            let request = {
                StackName   : `${this._stackConfig.stackName}-${this._stackConfig.stackEnv}`,
            };
            logOperation('Delete', this._stackConfig);
            this._awsCf.deleteStack(request, (error) => {
                error ? reject(error) : resolve();
            });
        });
    }

    publish(){
        let [s3Bucket, s3Key] = this._stackConfig.stackTemplateS3Uri.replace("s3://","")
            .split(/\/(.+)/, 2);

        let s3 = this._awsS3;
        logOperation('Publish', this._stackConfig);
        return new Promise((resolve, reject) => {
            Dir(this._stackConfig.stackPath, (err, files) => {
                if(err){
                    return reject(err);
                }
                Promise.all( files.map( file => {
                    return new Promise((resolve, reject) => {
                        let request = {
                            Bucket: s3Bucket,
                            Key   : s3Key,
                            Body  : Fs.createReadStream(file)
                        };
                        s3.upload(request, (err) => {
                            console.info(`  File '${file}' uploaded ${err ? 'with error' : 'successfully'}`);
                            err ? reject(err) : resolve()
                        })
                    });
                }))
                .then( () => resolve(), (err) => reject(err));
            });
        });
    }
}


module.exports = AwsStack;
