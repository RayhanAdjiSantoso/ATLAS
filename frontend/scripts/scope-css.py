"""Wrap a stylesheet in a scope class using native CSS nesting.

MRG owned its whole document, so its CSS styles :root / body / * directly.
Inside ATLAS that CSS shares a document with ATLAS's own stylesheet, which
defines the same custom-property names with different values. Everything is
therefore nested under one scope class; only the rules that targeted the
document root need rewriting, and they are listed explicitly below.
"""
import re
import sys

HOIST_AT = ('@keyframes', '@-webkit-keyframes', '@font-face', '@import', '@charset', '@property')

# Classes exportImage.ts toggles on the wrapper element itself. In MRG they
# went on <body>, so `.pdf-export-mode .metric-picker` matched as a descendant
# of the toggled element; here the toggled element IS the wrapper, so these
# have to become `&.pdf-export-mode .metric-picker` — self-and-has-the-class,
# not descendant-of.
SELF_CLASSES = ('.pdf-export-mode', '.png-fit-content')


def split_top_level(css):
    """Yield (kind, text) for each top-level construct.

    kind is 'comment', 'block' (prelude + {...}) or 'other' (stray text).
    """
    out, i, n, buf = [], 0, len(css), ''
    while i < n:
        # Comments are emitted on their own so they keep their position.
        if css.startswith('/*', i):
            end = css.find('*/', i + 2)
            end = n if end == -1 else end + 2
            if buf.strip():
                out.append(('other', buf))
            buf = ''
            out.append(('comment', css[i:end]))
            i = end
            continue
        if css[i] == '{':
            depth, j = 1, i + 1
            while j < n and depth:
                if css.startswith('/*', j):
                    e = css.find('*/', j + 2)
                    j = n if e == -1 else e + 2
                    continue
                if css[j] in '"\'':
                    q, j = css[j], j + 1
                    while j < n and css[j] != q:
                        j += 2 if css[j] == '\\' else 1
                    j += 1
                    continue
                depth += (css[j] == '{') - (css[j] == '}')
                j += 1
            out.append(('block', buf + css[i:j]))
            buf = ''
            i = j
            continue
        buf += css[i]
        i += 1
    if buf.strip():
        out.append(('other', buf))
    return out


def prelude_of(block):
    return block[:block.index('{')].strip()


def body_of(block):
    return block[block.index('{') + 1:block.rindex('}')]


def indent(text, pad='  '):
    return '\n'.join(pad + ln if ln.strip() else ln for ln in text.split('\n'))


def rewrite_prelude(sel):
    """Rewrite a top-level selector for life inside the scope wrapper.

    A nested selector with no '&' is read as a descendant of the wrapper, which
    is already right for every ordinary class selector — only selectors that
    named the document root need to change.
    """
    parts = [p.strip() for p in sel.split(',')]
    fixed = []
    for p in parts:
        if p == 'body' or p == 'html':
            # The wrapper element now plays the role body did.
            fixed.append('&')
        elif p.startswith('body.') or p.startswith('html.'):
            # e.g. `body.pdf-export-mode .sec-block` — the class lands on the
            # wrapper (see exportImage.ts), so drop the element and keep it.
            fixed.append('&' + p[p.index('.'):])
        elif p.startswith('body ') or p.startswith('html '):
            fixed.append('& ' + p.split(' ', 1)[1])
        elif p == '*' or p.startswith('*'):
            fixed.append('& ' + p)
        elif p.startswith(':'):
            # :focus-visible etc. — descendants of the wrapper, not the wrapper.
            fixed.append('& ' + p)
        elif p.startswith(SELF_CLASSES):
            fixed.append('&' + p)
        else:
            fixed.append(p)
    return ', '.join(fixed)


def rewrite_inner(css):
    """Rewrite the selectors one level inside an at-rule block."""
    out = []
    for kind, text in split_top_level(css):
        if kind != 'block':
            out.append(text if kind == 'comment' else text.strip())
            continue
        pre = prelude_of(text)
        if pre.lstrip().startswith('@'):
            out.append(pre + '{' + rewrite_inner(body_of(text)) + '}')
        else:
            out.append(rewrite_prelude(pre) + '{' + body_of(text) + '}')
    return '\n'.join(out)


def transform(css, scope):
    root_decls, hoisted, nested = [], [], []
    for kind, text in split_top_level(css):
        if kind == 'comment':
            nested.append(text)
            continue
        if kind == 'other':
            if text.strip():
                nested.append(text.strip())
            continue
        pre = prelude_of(text)
        # An at-rule that must stay at the document level (its name is global).
        if any(pre.lstrip().startswith(a) for a in HOIST_AT) or any(
            re.search(r'(^|\s)' + re.escape(a) + r'\b', pre) for a in HOIST_AT
        ):
            hoisted.append(text)
            continue
        # :root's custom properties become the wrapper's own declarations.
        if pre.split('{')[0].strip() == ':root':
            root_decls.append(body_of(text).strip('\n'))
            continue
        if pre.lstrip().startswith('@'):
            # @media / @supports / @container — the rules inside are relative
            # to the wrapper just like the ones outside, so recurse so that a
            # `body{}` or `*{}` in there gets rewritten too (@media print does
            # carry one).
            nested.append(pre + '{' + rewrite_inner(body_of(text)) + '}')
            continue
        nested.append(rewrite_prelude(pre) + '{' + body_of(text) + '}')

    parts = []
    if hoisted:
        parts.append('\n'.join(hoisted))
        parts.append('')
    parts.append(scope + '{')
    for d in root_decls:
        parts.append(indent(d))
    parts.append(indent('\n'.join(nested)))
    parts.append('}')
    return '\n'.join(parts) + '\n'


if __name__ == '__main__':
    src, dst, scope = sys.argv[1], sys.argv[2], sys.argv[3]
    header = sys.stdin.read()
    open(dst, 'w').write(header + transform(open(src).read(), scope))
    print('wrote', dst)
