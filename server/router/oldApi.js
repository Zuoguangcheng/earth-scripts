// todo: 压测时候有问题

const Router = require('koa-router');
const router = new Router();

const proxyToServer = require('../util/proxyToServer');
const logger = require('../util/logger');
const errorBody = require('../util/error').resBody;
const RES_CODE = require('../util/error').RES_CODE;
const {selfHandleResponseApi} = require('../def');
const config = require('../def');
const {getCusProxyRouter} = require('../context')


const defaultRouter = getCusProxyRouter('index.js')

module.exports = router;

router.all('/:name/:other*',
    async (ctx, next) => {
        const cusRouter = getCusProxyRouter(ctx.params.name) || defaultRouter;
        if (cusRouter && cusRouter.apiProxyBefore) {
            await cusRouter.apiProxyBefore(ctx);
        }
        await next()
    },
    async (ctx, next) => {

        // 请求透传
        // 不手动处理请求结果，无法设置额gzip压缩
        // await proxyToServer(ctx.req, ctx.res, {
        //     target: `${config.proxy}${getFullPath(ctx)}`,
        //     headers: {
        //         ip: '',
        //         'X-real-ip': ctx.ip //用户ip. ???经过nginx 这个值会不会被覆盖成本服务ip？
        //     },
        //     changeOrigin: true,
        //     agent: agent
        // })
        //     .catch((e) => {
        //         console.log(e)
        //     });
        const params = ctx.params;
        let ret = {};
        try {
            ret = await proxyToServer(ctx.req, ctx.res, {
                selfHandleResponse: selfHandleResponseApi || true,
                headers: {
                    ip: '',
                    'x-origin-ip': ctx.headers['x-forwarded-for'] || ctx.ip
                },
                target: `${ctx.app_proxyServer || config.proxyPath}/${params.name}/${params.other}`,
            })
        } catch (e) {
            // 代理失败
            logger.error(e.stack);
            ret = {
                headers: {},
                body: errorBody(RES_CODE.PTS_ERROR, e.toString())
            }
        }

        try {
            ctx.set(ret.headers);
        } catch (e) {
            ctx.set({});
            logger.error(e.stack);
        }


        ctx.status = ret.status || 200;

        if (!ret.body) {
            ctx.body = '';
            return next()
        }


        try {

            // todo: 为了标识代理成功，在返回结果中追加__fns（means: from node server)
            ctx.body = Object.assign(
                {},
                typeof ret.body === 'string' ? JSON.parse(ret.body) : ret.body,
                {__fns: true}
            )
        } catch (e) {
            logger.error(e.stack);
            ctx.body = ret.body
        }


        // save to log
        logger.info(`
        proxy-to-path: ${ctx.path}, 
        status: ${ctx.status},  
        ${ctx.method}: ${JSON.stringify(ctx.request.body)}
        response: ${typeof ctx.body === 'object' ? JSON.stringify(ctx.body) : ctx.body}
        `
        );

        await next()

    },
    async (ctx, next) => {
        const cusRouter = getCusProxyRouter(ctx.params.name) || defaultRouter;
        if (cusRouter && cusRouter.apiProxyReceived) {
            await cusRouter.apiProxyReceived(ctx);
        }
        await next()
    },
    () => {
        return
    }
);

