/*
 * Business logic HTTP API served by `connectjs` for node-webkit(local UI)
 * and for browsers(remote UI)
 */

module.exports = function run_app(){
var connect = require('connect')
   ,_404 = require('./middleware/404.js')
   ,sendFile = require('./middleware/sendFile.js')
   ,api  = require('./api.js')
   ,app  = api.app = connect()
   ,cfg  = api.cfg
   ,_log = api._log

    /* Application middleware setup */

    app.use(connect.cookieParser())
    app.use(connect.json())
    app.use(require('./middleware/postTextPlain.js'))

    /* ExtJS for HTTP users */
    remote_extjs_cfg()

    app.use('/app_back.js' , _404)// hide
    app.use('/app_front.js' , sendFile('app_front_http.js'))

    app.use(connect.session({
        secret: cfg.backend.sess_puzl
       ,generate: function(req, res){
            return req.url === '/login' //&& user not in store
        }
       //,store = require('connect-mongo')(app)
    }))

    require('../../app_modules')(api)

    /* backend static files for HTTP users */
    app.use('/' ,connect['static'](__dirname + '/..', { index: 'app.htm' }))//TODO: no directory traversal, serv just app.htm

    /* final stage: error path */
    app.use(require('./middleware/errorHandler.js'))
       .use(_404)// no middleware handled request
    .listen(cfg.backend.job_port ,function app_is_up_and_running(){
        _log('^ app is up and running\n' +
            new Date().toISOString()
        )
    })
    return

    function remote_extjs_cfg(){
        var fs = require('fs')
        if(cfg.extjs.pathFile){
            cfg.extjs.path = fs.readFileSync(cfg.extjs.pathFile).toString().trim()
        }
        app.use('/extjs/' ,connect['static'](__dirname + '/../' + cfg.extjs.path))
        cfg.extjs.path = 'extjs/'// switch local to external path
        app.use('/app.config.extjs.json' ,function($ ,res){ res.json(cfg.extjs) })
    }
}
