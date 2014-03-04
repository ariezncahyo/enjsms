config = {
/* NOTE: this is not JSON just JavaScript
 *       idea is taken from github.com/louischatriot/mongo-edit
 */
    gsm_modules:[
        {
            //name
            //addr:
        }
    ],

    /* standard configuration of extjs+node-webkit application */

    dev: 'enjsms',// developring this component
    log: 'log/',
    app:{
        db: { mongodb:1 ,nedb:0 }, // github.com/louischatriot/nedb
        modules:{// cfg things from 'app_modules'
            procman:{
                // default: cfg_procman.js in own directory
                config: 'config/cfg_procman_mongo_node_sms.js'
               ,autoSpawn: true
            }
           ,usersman:{
                store: 'dummy' //dummy (internal ro default roles), json file, db
            }
        }
    },
    extjs:{
        name: 'App',             // default
        appFolder: '.',          // default
        launch: null             // default
       ,pathFile: 'extjs.txt'
       ,path: 'ext-4.2.1.883/'   // search extjs.txt or this above './'; 'extjs/' is for HTML
       ,fading:!true             // visual effects for content appearance
    },
    backend:{
        file: 'app_main/app_back.js',
        ctl_port: 3008,
        job_port: 3007,
        sess_puzl: 'puzzle-word$50000X'
    }
   ,mongodb:{
         host: 'localhost'
        ,port: 27017
        ,journal: true
        ,dbname: 'test'
        ,dbpath: 'data/db'
        ,dbprefix: ''
    }
}
