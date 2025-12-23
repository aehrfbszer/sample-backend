interface Context<
  Data = Record<string, unknown>,
  State = Record<string, unknown>,
> {
  req: Request;
  data: Data; // 用于传递数据
  state: State; // 全局 state
}

type Handler<Data, State> = (
  c: Context<Data, State>,
) => Response | Promise<Response>;
type Middleware<Data, State> = (
  c: Context<Data, State>,
) => void | Promise<void>;

export interface MiddlewareType<T> {
  type: T;
}

export interface ModelType<PATH extends string, T> extends MiddlewareType<T> {
  path: PATH;
  type: T;
}

export interface NormalType<PATH extends string, T, M extends string>
  extends ModelType<PATH, T> {
  method: M;
}

export type GenModelPath<S, P extends string> = S extends ModelType<
  infer T,
  infer U
>
  ? NormalType<T, U, P>
  : never;

export type GetFromModel<S> = GenModelPath<S, "GET">;
export type PostFromModel<S> = GenModelPath<S, "POST">;
export type PutFromModel<S> = GenModelPath<S, "PUT">;
export type DeleteFromModel<S> = GenModelPath<S, "DELETE">;

export type GetPath<S> = S extends ModelType<infer P, unknown> ? P : never;
export type GetValue<S> = S extends ModelType<string, infer V> ? V : never;

class App<State = Record<string, unknown>> {
  #routes: Map<string, Map<string, Handler<unknown, State>>> = new Map();
  #middlewares: Middleware<unknown, State>[] = [];
  state: State = {} as State; // 全局 state

  withState<T>(state: T): App<T> {
    const newApp = new App<T>();
    newApp.#routes = this.#routes as any;
    newApp.#middlewares = this.#middlewares as any;
    newApp.state = state;
    return newApp;
  }

  use<T>(middleware: Middleware<T, State>) {
    this.#middlewares.push(middleware as Middleware<unknown, State>);
  }

  get<T>(path: GetPath<T>, handler: Handler<GetValue<T>, State>) {
    this.#addRoute("GET", path, handler);
  }

  post<T>(path: GetPath<T>, handler: Handler<GetValue<T>, State>) {
    this.#addRoute("POST", path, handler);
  }

  put<T>(path: GetPath<T>, handler: Handler<GetValue<T>, State>) {
    this.#addRoute("PUT", path, handler);
  }

  delete<T>(path: GetPath<T>, handler: Handler<GetValue<T>, State>) {
    this.#addRoute("DELETE", path, handler);
  }

  all<T>(path: GetPath<T>, handler: Handler<GetValue<T>, State>) {
    this.#addRoute("GET", path, handler);
    this.#addRoute("POST", path, handler);
    this.#addRoute("PUT", path, handler);
    this.#addRoute("DELETE", path, handler);
  }

  #addRoute<T>(method: string, path: string, handler: Handler<T, State>) {
    if (!this.#routes.has(path)) {
      this.#routes.set(path, new Map());
    }
    this.#routes.get(path)?.set(method, handler as Handler<unknown, State>);
  }

  async fetch(req: Request): Promise<Response> {
    const c: Context<unknown, State> = {
      req,
      data: {},
      state: this.state,
    };

    // 执行中间件
    for (const mw of this.#middlewares) {
      await mw(c);
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    const route = this.#routes.get(path);
    if (route?.has(method)) {
      const handler = route.get(method)!;
      return await handler(c);
    }

    return new Response("Not Found", { status: 404 });
  }
}

export default App;

// 示例使用（仅在 Node.js 中运行）
if (typeof process !== "undefined") {
  import("node:http").then(({ createServer }) => {
    const app = new App().withState<{ version: string }>({ version: "" });

    interface Time extends MiddlewareType<{ startTime: number }> {}

    interface GetDefault extends NormalType<"/", Time["type"], "GET"> {}

    interface User extends ModelType<"/users", { userId: string }> {}

    interface GetUsers
      extends NormalType<User["path"], { processed: boolean }, "GET"> {}

    interface PostUser extends PostFromModel<User> {}

    // 设置全局 state
    app.state.version = "1.0.0";

    app.use<Time["type"]>((c) => {
      console.log(`${c.req.method} ${c.req.url}`);
      c.data.startTime = Date.now(); // 在 data 中传递数据
    });

    app.get<GetDefault>("/", (c) => {
      const elapsed = Date.now() - c.data.startTime;
      return new Response(
        `Hello World! Version: ${c.state.version}, Elapsed: ${elapsed}ms`,
      );
    });

    app.get<GetUsers>("/users", (c) => {
      c.data.processed = true; // 传递数据
      return new Response(
        JSON.stringify({ users: [], processed: c.data.processed }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    });

    app.post<PostUser>("/users", async (c) => {
      const body = await c.req.json();
      return new Response(JSON.stringify({ message: "User created", body }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    app.delete<User>("/users", (c) => {
      return new Response(JSON.stringify({ message: "User deleted" }), {
        headers: { "Content-Type": "application/json" },
      });
    });

    const server = createServer(async (req, res) => {
      const url = `http://localhost${req.url}`;

      // 简单处理 body（暂时不支持流式 body）
      let body: string | undefined;
      if (!["GET", "HEAD"].includes(req.method!)) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks).toString();
      }

      const request = new Request(url, {
        method: req.method,
        headers: req.headers as any,
        body,
      });

      const response = await app.fetch(request);

      res.statusCode = response.status;
      for (const [key, value] of response.headers) {
        res.setHeader(key, value);
      }

      const responseBody = await response.text();
      res.end(responseBody);
    });

    server.listen(3000, () => {
      console.log("Server running on http://localhost:3000");
    });
  });
}
