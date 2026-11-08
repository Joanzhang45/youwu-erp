"""
dump_schema.py — 把資料庫 public schema 的完整結構匯出成兩份檔案（第二次健檢 #26）：

  supabase/schema.sql          從零重建用：型別、序號、函式、資料表、檢視、索引、觸發、RLS、權限、說明
  src/lib/database.generated.ts  前端型別：每張表／檢視一個 Row 型別，由資料庫實際欄位產生，不再手寫

為什麼不用 pg_dump：本機與 CI 不一定裝得到跟伺服器同版（17）的 pg_dump；這支只用 psycopg2 讀系統目錄。
Supabase 平台自己管的東西（auth／storage schema、event trigger、rls_auto_enable）不匯出，
CI 重建時用 supabase/ci/platform_stub.sql 補最小替身。

匯出範圍（沒列到的改動，CI 的比對關卡看不到，要自己留意）：public 的型別、序號（只有名稱，沒有起始值等參數）、
函式、資料表、約束、索引、檢視、觸發（含停用狀態）、RLS（含 FORCE）、policy、對 anon／authenticated／
service_role 的表／函式／序號權限、表與欄位說明。不含：欄位層級權限、ALTER DEFAULT PRIVILEGES、
函式／索引／型別的說明、storage 的 bucket 與 policy（點收照片 receiving-photos 的權限在 migration 014）。

用法（每次套用新 migration 之後跑一次，把兩份產出一起 commit）：
  DATABASE_URL=postgresql://... python scripts/dump_schema.py
CI 會用同一支程式對「重建出來的資料庫」再匯出一次，跟 repo 裡的檔案比對，不一致就擋上線。
"""
import os
import sys
from collections import defaultdict

import psycopg2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP_FUNCS = {"rls_auto_enable"}  # Supabase 平台的 event trigger 函式
API_ROLES = ("anon", "authenticated", "service_role")


# 名稱（name 型別）本來就用 C 定序；轉成 text 的排序欄位要明寫 COLLATE "C"，
# 否則線上（en_US）和 CI（另一種語系）排出來順序不同，CI 的比對關卡會誤擋。
def q(cur, sql, args=()):
    cur.execute(sql, args)
    return cur.fetchall()


def ident(name):
    return name if name.islower() and name.replace("_", "").isalnum() and not name[0].isdigit() else '"' + name.replace('"', '""') + '"'


def dump_sql(cur):
    out = [
        "-- 由 scripts/dump_schema.py 自動產生，請勿手改。改結構請寫 migration，套用後重跑本程式。",
        "-- 從零重建：先跑 supabase/ci/platform_stub.sql（只在非 Supabase 的 Postgres 需要），再跑本檔。",
        "SET check_function_bodies = off;",
        "SET client_min_messages = warning;",
        "",
    ]

    # ---- enum ----
    for name, labels in q(cur, """
        select t.typname, array_agg(e.enumlabel order by e.enumsortorder)
        from pg_type t join pg_enum e on e.enumtypid = t.oid
        where t.typnamespace = 'public'::regnamespace group by t.typname order by t.typname"""):
        vals = ", ".join("'" + v.replace("'", "''") + "'" for v in labels)
        out.append(f"CREATE TYPE public.{ident(name)} AS ENUM ({vals});")
    out.append("")

    # ---- sequences ----
    for (name,) in q(cur, "select relname from pg_class where relkind='S' and relnamespace='public'::regnamespace order by relname"):
        out.append(f"CREATE SEQUENCE public.{ident(name)};")
    out.append("")

    # ---- functions（check_function_bodies=off，先建函式，產生欄位才能用）----
    for name, ddl in q(cur, """
        select p.proname, pg_get_functiondef(p.oid) from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
        order by p.proname, pg_get_function_identity_arguments(p.oid) COLLATE "C" """):
        if name in SKIP_FUNCS:
            continue
        out.append(ddl.strip() + ";")
        out.append("")

    # ---- tables ----
    tables = [r[0] for r in q(cur, "select relname from pg_class where relkind='r' and relnamespace='public'::regnamespace order by relname")]
    cols = defaultdict(list)
    for tbl, col, typ, notnull, default, gen in q(cur, """
        select c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
               pg_get_expr(d.adbin, d.adrelid), a.attgenerated
        from pg_attribute a join pg_class c on c.oid = a.attrelid
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
        order by c.relname, a.attnum"""):
        line = f"  {ident(col)} {typ}"
        if gen == "s":
            line += f" GENERATED ALWAYS AS ({default}) STORED"
        elif default is not None:
            line += f" DEFAULT {default}"
        if notnull:
            line += " NOT NULL"
        cols[tbl].append(line)
    for t in tables:
        out.append(f"CREATE TABLE public.{ident(t)} (\n" + ",\n".join(cols[t]) + "\n);")
    out.append("")
    for seq, tbl, col in q(cur, """
        select s.relname, t.relname, a.attname from pg_depend d
        join pg_class s on s.oid = d.objid and s.relkind = 'S'
        join pg_class t on t.oid = d.refobjid
        join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
        where s.relnamespace = 'public'::regnamespace and d.deptype = 'a' order by s.relname"""):
        out.append(f"ALTER SEQUENCE public.{ident(seq)} OWNED BY public.{ident(tbl)}.{ident(col)};")
    out.append("")

    # ---- constraints：主鍵／唯一／檢查先，外鍵最後 ----
    for tbl, con, ddl in q(cur, """
        select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint
        where connamespace = 'public'::regnamespace and contype in ('p','u','c','x') and conrelid <> 0
        order by conrelid::regclass::text COLLATE "C", contype desc, conname"""):
        out.append(f"ALTER TABLE {tbl} ADD CONSTRAINT {ident(con)} {ddl};")
    for tbl, con, ddl in q(cur, """
        select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint
        where connamespace = 'public'::regnamespace and contype = 'f' order by conrelid::regclass::text COLLATE "C", conname"""):
        out.append(f"ALTER TABLE {tbl} ADD CONSTRAINT {ident(con)} {ddl};")
    out.append("")

    # ---- indexes（不含約束自帶的）----
    for (ddl,) in q(cur, """
        select pg_get_indexdef(i.indexrelid) from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relnamespace = 'public'::regnamespace
          and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)
        order by c.relname"""):
        out.append(ddl + ";")
    out.append("")

    # ---- views：依相依順序 ----
    views = {r[0]: (r[1], r[2]) for r in q(cur, """
        select c.relname, pg_get_viewdef(c.oid, true), coalesce(array_to_string(c.reloptions, ', '), '')
        from pg_class c where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace""")}
    deps = defaultdict(set)
    for v, ref in q(cur, """
        select distinct v.relname, r.relname from pg_rewrite w
        join pg_class v on v.oid = w.ev_class
        join pg_depend d on d.objid = w.oid
        join pg_class r on r.oid = d.refobjid
        where v.relkind = 'v' and r.relkind = 'v' and v.oid <> r.oid and v.relnamespace = 'public'::regnamespace"""):
        deps[v].add(ref)
    done, order = set(), []

    def visit(v):
        if v in done:
            return
        done.add(v)
        for d in sorted(deps[v]):
            if d in views:
                visit(d)
        order.append(v)

    for v in sorted(views):
        visit(v)
    for v in order:
        body, opts = views[v]
        with_ = f" WITH ({opts})" if opts else ""
        out.append(f"CREATE VIEW public.{ident(v)}{with_} AS\n{body.rstrip().rstrip(';')};")
        out.append("")

    # ---- triggers ----
    for (ddl,) in q(cur, """
        select pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by c.relname, t.tgname"""):
        out.append(ddl + ";")
    for tbl, trg, state in q(cur, """
        select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgenabled <> 'O'
        order by c.relname, t.tgname"""):
        mode = {"D": "DISABLE", "R": "ENABLE REPLICA", "A": "ENABLE ALWAYS"}[state]
        out.append(f"ALTER TABLE public.{ident(tbl)} {mode} TRIGGER {ident(trg)};")
    out.append("")

    # ---- RLS + policies ----
    for (t,) in q(cur, "select relname from pg_class where relkind='r' and relnamespace='public'::regnamespace and relrowsecurity order by relname"):
        out.append(f"ALTER TABLE public.{ident(t)} ENABLE ROW LEVEL SECURITY;")
    for (t,) in q(cur, "select relname from pg_class where relkind='r' and relnamespace='public'::regnamespace and relforcerowsecurity order by relname"):
        out.append(f"ALTER TABLE public.{ident(t)} FORCE ROW LEVEL SECURITY;")
    for tbl, pol, permissive, roles, cmd, qual, check in q(cur, """
        select tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies
        where schemaname = 'public' order by tablename, policyname"""):
        if isinstance(roles, str):  # psycopg2 回 '{authenticated}' 字串
            roles = [r for r in roles.strip("{}").split(",") if r]
        s = f"CREATE POLICY {ident(pol)} ON public.{ident(tbl)} AS {permissive} FOR {cmd} TO {', '.join(roles)}"
        if qual:
            s += f" USING ({qual})"
        if check:
            s += f" WITH CHECK ({check})"
        out.append(s + ";")
    out.append("")

    # ---- grants（只記 API 三個角色：先全收回，再照線上實際權限給，Supabase 的預設全開不算數）----
    rels = [t for (t,) in q(cur, "select relname from pg_class where relkind in ('r','v') and relnamespace='public'::regnamespace order by relname")]
    for t in rels:
        out.append(f"REVOKE ALL ON TABLE public.{ident(t)} FROM {', '.join(API_ROLES)};")
    for name, grantee, privs in q(cur, f"""
        select c.relname, a.grantee::regrole::text, string_agg(a.privilege_type, ', ' order by a.privilege_type COLLATE "C")
        from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v')
          and a.grantee <> 0 and a.grantee::regrole::text in {API_ROLES}
        group by 1, 2 order by c.relname, a.grantee::regrole::text COLLATE "C" """):
        out.append(f"GRANT {privs} ON TABLE public.{ident(name)} TO {grantee};")
    out.append(f"REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, {', '.join(API_ROLES)};")
    who = "case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end"
    for name, args, grantee in q(cur, f"""
        select p.proname, pg_get_function_identity_arguments(p.oid), {who}
        from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and a.privilege_type = 'EXECUTE'
          and {who} in ('PUBLIC', 'anon', 'authenticated', 'service_role')
        order by p.proname, pg_get_function_identity_arguments(p.oid) COLLATE "C", {who} COLLATE "C" """):
        if name in SKIP_FUNCS:
            continue
        out.append(f"GRANT EXECUTE ON FUNCTION public.{ident(name)}({args}) TO {grantee};")
    seqs = [s for (s,) in q(cur, "select relname from pg_class where relkind='S' and relnamespace='public'::regnamespace order by relname")]
    for s in seqs:
        out.append(f"REVOKE ALL ON SEQUENCE public.{ident(s)} FROM {', '.join(API_ROLES)};")
    for name, grantee, privs in q(cur, f"""
        select c.relname, a.grantee::regrole::text, string_agg(a.privilege_type, ', ' order by a.privilege_type COLLATE "C")
        from pg_class c, aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
          and a.grantee <> 0 and a.grantee::regrole::text in {API_ROLES}
        group by 1, 2 order by c.relname, a.grantee::regrole::text COLLATE "C" """):
        out.append(f"GRANT {privs} ON SEQUENCE public.{ident(name)} TO {grantee};")
    out.append("")

    # ---- comments ----
    for objtype, name, text in q(cur, """
        select case c.relkind when 'v' then 'VIEW' else 'TABLE' end, c.relname, d.description
        from pg_description d join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass and d.objsubid = 0
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v') order by c.relname"""):
        out.append(f"COMMENT ON {objtype} public.{ident(name)} IS '{text.replace(chr(39), chr(39) * 2)}';")
    for tbl, col, text in q(cur, """
        select c.relname, a.attname, d.description from pg_description d
        join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass
        join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid
        where c.relnamespace = 'public'::regnamespace and d.objsubid > 0 order by c.relname, a.attnum"""):
        out.append(f"COMMENT ON COLUMN public.{ident(tbl)}.{ident(col)} IS '{text.replace(chr(39), chr(39) * 2)}';")
    out.append("")
    return "\n".join(out)


TS_TYPES = {
    "bigint": "number", "integer": "number", "smallint": "number", "numeric": "number", "real": "number",
    "double precision": "number", "boolean": "boolean", "json": "unknown", "jsonb": "unknown",
}


def ts_type(pg):
    base = pg.split("(")[0].strip()
    if base.endswith("[]"):
        return ts_type(base[:-2]) + "[]"
    return TS_TYPES.get(base, "string")  # text、日期、時間、uuid、enum 從 API 回來都是字串


def dump_ts(cur):
    rels = defaultdict(list)
    for rel, kind, col, typ, notnull in q(cur, """
        select c.relname, c.relkind, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull
        from pg_attribute a join pg_class c on c.oid = a.attrelid
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v') and a.attnum > 0 and not a.attisdropped
        order by c.relkind, c.relname, a.attnum"""):
        rels[(kind, rel)].append((col, typ, notnull))
    enums = q(cur, """
        select t.typname, array_agg(e.enumlabel order by e.enumsortorder) from pg_type t
        join pg_enum e on e.enumtypid = t.oid where t.typnamespace = 'public'::regnamespace group by 1 order by 1""")
    enum_names = {n for n, _ in enums}
    out = [
        "// 由 scripts/dump_schema.py 依資料庫實際欄位自動產生，請勿手改。",
        "// 資料表欄位的「可能是 null」照資料庫 NOT NULL 設定；檢視（v_ 開頭）的欄位資料庫不記 NOT NULL，一律可能是 null。",
        "",
    ]
    for n, labels in enums:
        out.append(f"export type {n} = " + " | ".join(f'"{l}"' for l in labels) + ";")
    out.append("")
    out.append("export interface Tables {")
    for (kind, rel), cs in sorted(rels.items(), key=lambda x: x[0][1]):
        if kind != "r":
            continue
        out.append(f"  {rel}: {{")
        for col, typ, nn in cs:
            t = typ if typ in enum_names else ts_type(typ)
            out.append(f"    {col}: {t}{'' if nn else ' | null'};")
        out.append("  };")
    out.append("}")
    out.append("")
    out.append("export interface Views {")
    for (kind, rel), cs in sorted(rels.items(), key=lambda x: x[0][1]):
        if kind != "v":
            continue
        out.append(f"  {rel}: {{")
        for col, typ, _ in cs:
            t = typ if typ in enum_names else ts_type(typ)
            out.append(f"    {col}: {t} | null;")
        out.append("  };")
    out.append("}")
    out.append("")
    return "\n".join(out)


def main():
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("缺少 DATABASE_URL")
    sql_path = os.path.join(ROOT, "supabase", "schema.sql")
    ts_path = os.path.join(ROOT, "src", "lib", "database.generated.ts")
    if "--out-dir" in sys.argv:
        d = sys.argv[sys.argv.index("--out-dir") + 1]
        sql_path, ts_path = os.path.join(d, "schema.sql"), os.path.join(d, "database.generated.ts")
    conn = psycopg2.connect(url)
    try:
        cur = conn.cursor()
        sql, ts = dump_sql(cur), dump_ts(cur)
    finally:
        conn.close()
    for path, text in ((sql_path, sql), (ts_path, ts)):
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print("wrote", path)


if __name__ == "__main__":
    main()
