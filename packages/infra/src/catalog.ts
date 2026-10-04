import type { Ecosystem } from "./types.js";

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  brief: string;
  docs: string;
  /** Package names per ecosystem that indicate this framework. A trailing `*` matches a prefix. */
  packages: Partial<Record<Ecosystem, string[]>>;
  /** Python import names when they differ from the distribution name. */
  modules?: string[];
  /** Config file name patterns (regex source, matched against the base name). */
  config?: string[];
}

/**
 * Static, hand-written descriptions. Phase 2 adds LLM-written "how this repo
 * uses it" prose on top; these briefs stay as the neutral baseline.
 */
export const CATALOG: CatalogEntry[] = [
  // JavaScript / TypeScript: frameworks and runtimes
  {
    id: "react",
    name: "React",
    category: "UI library",
    brief:
      "A library for building user interfaces from components: functions that take props and return markup (JSX). React re-renders a component when its state or props change and updates only the parts of the page that differ.",
    docs: "https://react.dev",
    packages: { npm: ["react", "react-dom"] },
  },
  {
    id: "next",
    name: "Next.js",
    category: "Full-stack web framework",
    brief:
      "A React framework that adds file-based routing, server-side rendering, static generation, and API routes. Folders under `app/` or `pages/` become URLs.",
    docs: "https://nextjs.org/docs",
    packages: { npm: ["next"] },
    config: ["^next\\.config\\.[cm]?[jt]s$"],
  },
  {
    id: "vue",
    name: "Vue",
    category: "UI framework",
    brief:
      "A UI framework built around single-file components (`.vue`) that combine template, script, and style. Reactive state automatically updates the DOM when it changes.",
    docs: "https://vuejs.org/guide/introduction.html",
    packages: { npm: ["vue"] },
  },
  {
    id: "nuxt",
    name: "Nuxt",
    category: "Full-stack web framework",
    brief:
      "A Vue framework for server-rendered and static sites with file-based routing and auto-imports.",
    docs: "https://nuxt.com/docs",
    packages: { npm: ["nuxt"] },
    config: ["^nuxt\\.config\\.[cm]?[jt]s$"],
  },
  {
    id: "svelte",
    name: "Svelte / SvelteKit",
    category: "UI framework",
    brief:
      "A component framework that compiles components to plain JavaScript at build time instead of shipping a runtime. SvelteKit adds routing and server rendering.",
    docs: "https://svelte.dev/docs",
    packages: { npm: ["svelte", "@sveltejs/kit"] },
    config: ["^svelte\\.config\\.[cm]?js$"],
  },
  {
    id: "angular",
    name: "Angular",
    category: "UI framework",
    brief:
      "A full frontend framework with components, dependency injection, routing, and forms built in. Code is organized into components and services wired together by decorators.",
    docs: "https://angular.dev",
    packages: { npm: ["@angular/core"] },
    config: ["^angular\\.json$"],
  },
  {
    id: "solid",
    name: "SolidJS",
    category: "UI library",
    brief:
      "A JSX UI library with fine-grained reactivity: signals update exactly the DOM nodes that depend on them, without a virtual DOM.",
    docs: "https://docs.solidjs.com",
    packages: { npm: ["solid-js"] },
  },
  {
    id: "astro",
    name: "Astro",
    category: "Web framework",
    brief:
      "A content-focused site framework that renders pages to HTML and ships JavaScript only for interactive islands.",
    docs: "https://docs.astro.build",
    packages: { npm: ["astro"] },
    config: ["^astro\\.config\\.[cm]?[jt]s$"],
  },
  {
    id: "express",
    name: "Express",
    category: "Web server framework",
    brief:
      "A minimal Node.js HTTP framework. You register middleware and route handlers (`app.get(path, handler)`); each request flows through the middleware chain until a handler sends a response.",
    docs: "https://expressjs.com",
    packages: { npm: ["express"] },
  },
  {
    id: "fastify",
    name: "Fastify",
    category: "Web server framework",
    brief:
      "A fast Node.js HTTP framework built around plugins, with JSON schema validation and serialization for routes.",
    docs: "https://fastify.dev/docs/latest/",
    packages: { npm: ["fastify"] },
  },
  {
    id: "koa",
    name: "Koa",
    category: "Web server framework",
    brief:
      "A small Node.js HTTP framework where middleware are async functions sharing a single context object.",
    docs: "https://koajs.com",
    packages: { npm: ["koa"] },
  },
  {
    id: "hono",
    name: "Hono",
    category: "Web server framework",
    brief:
      "A small web framework built on Web Standard Request/Response that runs on Node, Bun, Deno, and edge platforms.",
    docs: "https://hono.dev/docs",
    packages: { npm: ["hono"] },
  },
  {
    id: "nestjs",
    name: "NestJS",
    category: "Web server framework",
    brief:
      "A structured Node.js server framework using TypeScript decorators, modules, controllers, and dependency injection, similar in style to Angular.",
    docs: "https://docs.nestjs.com",
    packages: { npm: ["@nestjs/core"] },
  },
  {
    id: "electron",
    name: "Electron",
    category: "Desktop app framework",
    brief:
      "Builds desktop apps with web technologies. A main process (Node) manages windows; renderer processes run the web UI.",
    docs: "https://www.electronjs.org/docs",
    packages: { npm: ["electron"] },
  },
  {
    id: "react-native",
    name: "React Native",
    category: "Mobile app framework",
    brief:
      "Builds native iOS and Android apps with React components that render to native views instead of HTML.",
    docs: "https://reactnative.dev/docs/getting-started",
    packages: { npm: ["react-native", "expo"] },
  },
  // JS data, validation, state
  {
    id: "prisma",
    name: "Prisma",
    category: "ORM / database",
    brief:
      "A TypeScript ORM. The database schema lives in `schema.prisma`; Prisma generates a typed client from it and manages migrations.",
    docs: "https://www.prisma.io/docs",
    packages: { npm: ["prisma", "@prisma/client"] },
    config: ["^schema\\.prisma$"],
  },
  {
    id: "drizzle",
    name: "Drizzle ORM",
    category: "ORM / database",
    brief:
      "A TypeScript ORM where tables are declared in code and queries are written with a typed, SQL-like builder.",
    docs: "https://orm.drizzle.team/docs/overview",
    packages: { npm: ["drizzle-orm", "drizzle-kit"] },
    config: ["^drizzle\\.config\\.[cm]?[jt]s$"],
  },
  {
    id: "typeorm",
    name: "TypeORM",
    category: "ORM / database",
    brief: "An ORM for TypeScript that maps classes decorated with `@Entity` to database tables.",
    docs: "https://typeorm.io",
    packages: { npm: ["typeorm"] },
  },
  {
    id: "mongoose",
    name: "Mongoose",
    category: "ODM / database",
    brief: "Models MongoDB documents with schemas, validation, and middleware hooks.",
    docs: "https://mongoosejs.com/docs/",
    packages: { npm: ["mongoose"] },
  },
  {
    id: "zod",
    name: "Zod",
    category: "Validation",
    brief:
      "Declares data schemas in TypeScript and validates unknown input against them at runtime (`schema.parse(data)`), inferring static types from the same schema.",
    docs: "https://zod.dev",
    packages: { npm: ["zod"] },
  },
  {
    id: "redux",
    name: "Redux",
    category: "State management",
    brief:
      "Keeps app state in a single store updated by pure reducer functions in response to dispatched actions.",
    docs: "https://redux.js.org",
    packages: { npm: ["redux", "@reduxjs/toolkit"] },
  },
  {
    id: "tanstack-query",
    name: "TanStack Query",
    category: "Data fetching",
    brief:
      "Fetches, caches, and synchronizes server data in UI apps, with automatic refetching and cache invalidation.",
    docs: "https://tanstack.com/query/latest/docs",
    packages: { npm: ["@tanstack/react-query", "@tanstack/vue-query", "react-query"] },
  },
  {
    id: "graphql",
    name: "GraphQL",
    category: "API",
    brief:
      "A query language for APIs: clients ask for exactly the fields they need from a typed schema.",
    docs: "https://graphql.org/learn/",
    packages: {
      npm: ["graphql", "@apollo/server", "@apollo/client"],
      pypi: ["graphene", "strawberry-graphql"],
    },
  },
  {
    id: "trpc",
    name: "tRPC",
    category: "API",
    brief:
      "Defines typed API procedures on the server and calls them from a TypeScript client without code generation.",
    docs: "https://trpc.io/docs",
    packages: { npm: ["@trpc/server", "@trpc/client"] },
  },
  {
    id: "axios",
    name: "Axios",
    category: "HTTP client",
    brief:
      "A promise-based HTTP client for browsers and Node with interceptors and automatic JSON handling.",
    docs: "https://axios-http.com/docs/intro",
    packages: { npm: ["axios"] },
  },
  {
    id: "jsonwebtoken",
    name: "jsonwebtoken",
    category: "Auth",
    brief:
      "Signs and verifies JSON Web Tokens (JWTs), compact signed tokens commonly used for sessions and API auth.",
    docs: "https://github.com/auth0/node-jsonwebtoken#readme",
    packages: { npm: ["jsonwebtoken"] },
  },
  {
    id: "tailwind",
    name: "Tailwind CSS",
    category: "Styling",
    brief:
      "A utility-first CSS framework: you style elements with small classes like `p-4 text-sm` and unused styles are removed at build time.",
    docs: "https://tailwindcss.com/docs",
    packages: { npm: ["tailwindcss"] },
    config: ["^tailwind\\.config\\.[cm]?[jt]s$"],
  },
  // JS tooling
  {
    id: "typescript",
    name: "TypeScript",
    category: "Language / type checker",
    brief:
      "Adds static types to JavaScript. `tsc` type-checks the code and can compile it to JavaScript; `tsconfig.json` controls both.",
    docs: "https://www.typescriptlang.org/docs/",
    packages: { npm: ["typescript"] },
    config: ["^tsconfig.*\\.json$"],
  },
  {
    id: "vite",
    name: "Vite",
    category: "Build tool / dev server",
    brief:
      "A dev server with instant hot reload and a production bundler (Rollup-based) for web apps and libraries.",
    docs: "https://vite.dev/guide/",
    packages: { npm: ["vite"] },
    config: ["^vite\\.config\\.[cm]?[jt]s$"],
  },
  {
    id: "webpack",
    name: "webpack",
    category: "Bundler",
    brief:
      "Bundles modules and assets into files for the browser, configured with loaders and plugins.",
    docs: "https://webpack.js.org/concepts/",
    packages: { npm: ["webpack"] },
    config: ["^webpack\\..*\\.?[cm]?js$"],
  },
  {
    id: "esbuild",
    name: "esbuild",
    category: "Bundler",
    brief: "A very fast JavaScript and TypeScript bundler and transpiler written in Go.",
    docs: "https://esbuild.github.io",
    packages: { npm: ["esbuild", "tsup"] },
  },
  {
    id: "turborepo",
    name: "Turborepo",
    category: "Monorepo build system",
    brief: "Runs tasks across packages in a monorepo in dependency order and caches their outputs.",
    docs: "https://turbo.build/repo/docs",
    packages: { npm: ["turbo"] },
    config: ["^turbo\\.json$"],
  },
  {
    id: "nx",
    name: "Nx",
    category: "Monorepo build system",
    brief:
      "A monorepo tool that understands the project graph, runs only affected tasks, and caches results.",
    docs: "https://nx.dev/getting-started/intro",
    packages: { npm: ["nx"] },
    config: ["^nx\\.json$"],
  },
  {
    id: "vitest",
    name: "Vitest",
    category: "Test runner",
    brief: "A Vite-powered test runner with a Jest-compatible API (`describe`, `it`, `expect`).",
    docs: "https://vitest.dev/guide/",
    packages: { npm: ["vitest"] },
    config: ["^vitest\\.config\\.[cm]?[jt]s$"],
  },
  {
    id: "jest",
    name: "Jest",
    category: "Test runner",
    brief: "A JavaScript test runner with built-in assertions, mocking, and snapshot testing.",
    docs: "https://jestjs.io/docs/getting-started",
    packages: { npm: ["jest"] },
    config: ["^jest\\.config\\.[cm]?[jt]s(on)?$"],
  },
  {
    id: "mocha",
    name: "Mocha",
    category: "Test runner",
    brief:
      "A flexible JavaScript test runner usually paired with an assertion library such as Chai.",
    docs: "https://mochajs.org",
    packages: { npm: ["mocha"] },
    config: ["^\\.mocharc\\..*$"],
  },
  {
    id: "playwright",
    name: "Playwright",
    category: "End-to-end testing",
    brief: "Drives real browsers to test web apps end to end.",
    docs: "https://playwright.dev/docs/intro",
    packages: { npm: ["@playwright/test", "playwright"], pypi: ["playwright"] },
    config: ["^playwright\\.config\\.[cm]?[jt]s$"],
  },
  {
    id: "cypress",
    name: "Cypress",
    category: "End-to-end testing",
    brief: "Runs end-to-end and component tests in a browser with an interactive test runner.",
    docs: "https://docs.cypress.io",
    packages: { npm: ["cypress"] },
    config: ["^cypress\\.config\\.[cm]?[jt]s$"],
  },
  {
    id: "eslint",
    name: "ESLint",
    category: "Linter",
    brief: "Finds problems in JavaScript and TypeScript code using configurable rules.",
    docs: "https://eslint.org/docs/latest/",
    packages: { npm: ["eslint"] },
    config: ["^eslint\\.config\\.[cm]?[jt]s$", "^\\.eslintrc(\\..*)?$"],
  },
  {
    id: "prettier",
    name: "Prettier",
    category: "Formatter",
    brief: "Reformats code to a consistent style so formatting is never debated in review.",
    docs: "https://prettier.io/docs/",
    packages: { npm: ["prettier"] },
    config: ["^\\.prettierrc(\\..*)?$", "^prettier\\.config\\.[cm]?js$"],
  },
  {
    id: "biome",
    name: "Biome",
    category: "Linter and formatter",
    brief: "A fast all-in-one formatter and linter for JavaScript, TypeScript, JSON, and CSS.",
    docs: "https://biomejs.dev/guides/getting-started/",
    packages: { npm: ["@biomejs/biome"] },
    config: ["^biome\\.jsonc?$"],
  },
  {
    id: "commander",
    name: "Commander.js",
    category: "CLI framework",
    brief: "Defines command-line programs: commands, options, and arguments, with generated help.",
    docs: "https://github.com/tj/commander.js#readme",
    packages: { npm: ["commander"] },
  },
  // Python
  {
    id: "django",
    name: "Django",
    category: "Web framework",
    brief:
      "A batteries-included Python web framework: ORM models, URL routing, views, templates, admin, and auth. Projects are split into apps, configured through `settings.py`.",
    docs: "https://docs.djangoproject.com/en/stable/",
    packages: { pypi: ["django"] },
    config: ["^settings\\.py$", "^manage\\.py$"],
  },
  {
    id: "drf",
    name: "Django REST framework",
    category: "API framework",
    brief: "Builds REST APIs on Django with serializers, viewsets, routers, and authentication.",
    docs: "https://www.django-rest-framework.org",
    packages: { pypi: ["djangorestframework"] },
    modules: ["rest_framework"],
  },
  {
    id: "flask",
    name: "Flask",
    category: "Web framework",
    brief:
      "A lightweight Python web framework: you decorate functions with `@app.route(...)` to handle URLs.",
    docs: "https://flask.palletsprojects.com",
    packages: { pypi: ["flask"] },
  },
  {
    id: "fastapi",
    name: "FastAPI",
    category: "Web framework",
    brief:
      "A Python web framework for APIs. Route functions are decorated with `@app.get(...)`; type hints on parameters drive request validation (via Pydantic) and generate OpenAPI docs.",
    docs: "https://fastapi.tiangolo.com",
    packages: { pypi: ["fastapi"] },
  },
  {
    id: "starlette",
    name: "Starlette",
    category: "Web framework",
    brief: "A lightweight ASGI toolkit for async Python web services; FastAPI is built on it.",
    docs: "https://www.starlette.io",
    packages: { pypi: ["starlette"] },
  },
  {
    id: "uvicorn",
    name: "Uvicorn",
    category: "ASGI server",
    brief: "Runs async Python web apps (ASGI apps such as FastAPI or Starlette) as an HTTP server.",
    docs: "https://www.uvicorn.org",
    packages: { pypi: ["uvicorn"] },
  },
  {
    id: "gunicorn",
    name: "Gunicorn",
    category: "WSGI server",
    brief:
      "A production HTTP server for Python WSGI apps such as Django and Flask, using multiple worker processes.",
    docs: "https://docs.gunicorn.org",
    packages: { pypi: ["gunicorn"] },
  },
  {
    id: "pydantic",
    name: "Pydantic",
    category: "Validation",
    brief:
      "Defines data models as Python classes with type hints and validates and converts input data against them.",
    docs: "https://docs.pydantic.dev",
    packages: { pypi: ["pydantic"] },
  },
  {
    id: "sqlalchemy",
    name: "SQLAlchemy",
    category: "ORM / database",
    brief:
      "The standard Python SQL toolkit and ORM. Tables are mapped to Python classes (declarative models), and queries are built in Python and executed through a session.",
    docs: "https://docs.sqlalchemy.org",
    packages: { pypi: ["sqlalchemy"] },
  },
  {
    id: "alembic",
    name: "Alembic",
    category: "Database migrations",
    brief:
      "Versions database schema changes for SQLAlchemy as migration scripts that can be applied and rolled back.",
    docs: "https://alembic.sqlalchemy.org",
    packages: { pypi: ["alembic"] },
    config: ["^alembic\\.ini$"],
  },
  {
    id: "celery",
    name: "Celery",
    category: "Task queue",
    brief:
      "Runs background jobs in worker processes, with tasks sent through a broker such as Redis or RabbitMQ.",
    docs: "https://docs.celeryq.dev",
    packages: { pypi: ["celery"] },
  },
  {
    id: "requests",
    name: "Requests",
    category: "HTTP client",
    brief: "The most common synchronous HTTP client for Python.",
    docs: "https://requests.readthedocs.io",
    packages: { pypi: ["requests"] },
  },
  {
    id: "httpx",
    name: "HTTPX",
    category: "HTTP client",
    brief: "An HTTP client for Python with both sync and async APIs.",
    docs: "https://www.python-httpx.org",
    packages: { pypi: ["httpx"] },
  },
  {
    id: "click",
    name: "Click / Typer",
    category: "CLI framework",
    brief:
      "Builds command-line interfaces from decorated Python functions. Typer builds on Click using type hints.",
    docs: "https://click.palletsprojects.com",
    packages: { pypi: ["click", "typer"] },
  },
  {
    id: "numpy",
    name: "NumPy",
    category: "Numerical computing",
    brief:
      "Fast n-dimensional arrays and vectorized math for Python; the base of the scientific Python stack.",
    docs: "https://numpy.org/doc/stable/",
    packages: { pypi: ["numpy"] },
  },
  {
    id: "pandas",
    name: "pandas",
    category: "Data analysis",
    brief: "Tabular data structures (DataFrame, Series) for loading, cleaning, and analyzing data.",
    docs: "https://pandas.pydata.org/docs/",
    packages: { pypi: ["pandas"] },
  },
  {
    id: "pytorch",
    name: "PyTorch",
    category: "Machine learning",
    brief:
      "A deep learning framework built on tensors with automatic differentiation; models are Python classes built from `nn.Module`.",
    docs: "https://pytorch.org/docs/stable/",
    packages: { pypi: ["torch"] },
  },
  {
    id: "tensorflow",
    name: "TensorFlow",
    category: "Machine learning",
    brief:
      "A machine learning framework for building and training models, often through its Keras API.",
    docs: "https://www.tensorflow.org/api_docs",
    packages: { pypi: ["tensorflow"] },
  },
  {
    id: "scikit-learn",
    name: "scikit-learn",
    category: "Machine learning",
    brief:
      "Classic machine learning algorithms (classification, regression, clustering) with a consistent fit/predict API.",
    docs: "https://scikit-learn.org/stable/",
    packages: { pypi: ["scikit-learn"] },
    modules: ["sklearn"],
  },
  {
    id: "pyyaml",
    name: "PyYAML",
    category: "Serialization",
    brief: "Reads and writes YAML in Python.",
    docs: "https://pyyaml.org/wiki/PyYAMLDocumentation",
    packages: { pypi: ["pyyaml"] },
    modules: ["yaml"],
  },
  {
    id: "pytest",
    name: "pytest",
    category: "Test runner",
    brief:
      "The standard Python test runner: tests are plain functions using `assert`, with fixtures for setup and `conftest.py` for shared fixtures.",
    docs: "https://docs.pytest.org",
    packages: { pypi: ["pytest"] },
    config: ["^pytest\\.ini$", "^conftest\\.py$"],
  },
  {
    id: "ruff",
    name: "Ruff",
    category: "Linter and formatter",
    brief:
      "A very fast Python linter and formatter that replaces Flake8, isort, and Black for most projects.",
    docs: "https://docs.astral.sh/ruff/",
    packages: { pypi: ["ruff"] },
    config: ["^ruff\\.toml$", "^\\.ruff\\.toml$"],
  },
  {
    id: "black",
    name: "Black",
    category: "Formatter",
    brief: "An opinionated Python code formatter.",
    docs: "https://black.readthedocs.io",
    packages: { pypi: ["black"] },
  },
  {
    id: "mypy",
    name: "mypy",
    category: "Type checker",
    brief: "Checks Python type hints statically and reports type errors without running the code.",
    docs: "https://mypy.readthedocs.io",
    packages: { pypi: ["mypy"] },
    config: ["^mypy\\.ini$"],
  },
  // Go
  {
    id: "gin",
    name: "Gin",
    category: "Web framework",
    brief: "A fast HTTP web framework for Go with routing, middleware, and JSON binding.",
    docs: "https://gin-gonic.com/docs/",
    packages: { go: ["github.com/gin-gonic/gin"] },
  },
  {
    id: "echo",
    name: "Echo",
    category: "Web framework",
    brief: "A minimalist Go web framework with routing and middleware.",
    docs: "https://echo.labstack.com/docs",
    packages: { go: ["github.com/labstack/echo*"] },
  },
  {
    id: "cobra",
    name: "Cobra",
    category: "CLI framework",
    brief: "Builds Go command-line apps as trees of commands with flags and generated help.",
    docs: "https://cobra.dev",
    packages: { go: ["github.com/spf13/cobra"] },
  },
  {
    id: "gorm",
    name: "GORM",
    category: "ORM / database",
    brief: "An ORM for Go that maps structs to database tables.",
    docs: "https://gorm.io/docs/",
    packages: { go: ["gorm.io/gorm"] },
  },
  // Rust
  {
    id: "tokio",
    name: "Tokio",
    category: "Async runtime",
    brief:
      "The most widely used async runtime for Rust: it schedules futures, and provides async I/O, timers, and channels.",
    docs: "https://tokio.rs/tokio/tutorial",
    packages: { cargo: ["tokio"] },
  },
  {
    id: "serde",
    name: "Serde",
    category: "Serialization",
    brief:
      "Serializes and deserializes Rust data structures through derived `Serialize`/`Deserialize` traits.",
    docs: "https://serde.rs",
    packages: { cargo: ["serde"] },
  },
  {
    id: "axum",
    name: "Axum",
    category: "Web framework",
    brief:
      "A Rust web framework built on Tokio and Tower, where handlers are async functions with typed extractors.",
    docs: "https://docs.rs/axum",
    packages: { cargo: ["axum"] },
  },
  {
    id: "actix-web",
    name: "Actix Web",
    category: "Web framework",
    brief: "A high-performance Rust web framework.",
    docs: "https://actix.rs/docs/",
    packages: { cargo: ["actix-web"] },
  },
  {
    id: "clap",
    name: "clap",
    category: "CLI framework",
    brief: "Parses command-line arguments in Rust, usually by deriving a parser from a struct.",
    docs: "https://docs.rs/clap",
    packages: { cargo: ["clap"] },
  },
  // JVM, Ruby, PHP
  {
    id: "spring-boot",
    name: "Spring Boot",
    category: "Web framework",
    brief:
      "An opinionated Java framework for production services with auto-configuration, dependency injection, and embedded servers.",
    docs: "https://docs.spring.io/spring-boot/",
    packages: { maven: ["org.springframework.boot:*"] },
  },
  {
    id: "junit",
    name: "JUnit",
    category: "Test runner",
    brief: "The standard unit testing framework for Java.",
    docs: "https://junit.org/junit5/docs/current/user-guide/",
    packages: { maven: ["org.junit.jupiter:*", "junit:junit"] },
  },
  {
    id: "rails",
    name: "Ruby on Rails",
    category: "Web framework",
    brief:
      "A full-stack Ruby web framework following model-view-controller and convention over configuration.",
    docs: "https://guides.rubyonrails.org",
    packages: { gem: ["rails"] },
  },
  {
    id: "rspec",
    name: "RSpec",
    category: "Test runner",
    brief: "A behavior-driven testing framework for Ruby.",
    docs: "https://rspec.info/documentation/",
    packages: { gem: ["rspec", "rspec-rails"] },
  },
  {
    id: "laravel",
    name: "Laravel",
    category: "Web framework",
    brief:
      "A full-stack PHP framework with routing, the Eloquent ORM, queues, and Blade templates.",
    docs: "https://laravel.com/docs",
    packages: { composer: ["laravel/framework"] },
  },
];

/** PEP 503 normalized distribution name: lowercase, runs of `-_.` collapsed to `-`. */
export function normalizePypi(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** Import names that differ from distribution names, for usage lookup. */
const PY_MODULES: Record<string, string[]> = {
  pyyaml: ["yaml"],
  pillow: ["PIL"],
  "scikit-learn": ["sklearn"],
  beautifulsoup4: ["bs4"],
  "opencv-python": ["cv2"],
  "python-dateutil": ["dateutil"],
  "python-dotenv": ["dotenv"],
  "psycopg2-binary": ["psycopg2"],
  djangorestframework: ["rest_framework"],
  protobuf: ["google"],
  attrs: ["attr", "attrs"],
  "typing-extensions": ["typing_extensions"],
};

export function pythonModulesFor(distribution: string): string[] {
  const n = normalizePypi(distribution);
  return PY_MODULES[n] ?? [n.replace(/-/g, "_")];
}

export function matchesPackage(pattern: string, name: string, ecosystem: string): boolean {
  const norm = (s: string) => (ecosystem === "pypi" ? normalizePypi(s) : s.toLowerCase());
  if (pattern.endsWith("*")) return norm(name).startsWith(norm(pattern.slice(0, -1)));
  return norm(pattern) === norm(name);
}
