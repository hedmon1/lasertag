import type { ReactNode } from 'react';

/** A dark block with a coloured title bar, in the style of the StakeUp site's cards. */
export function Panel(props: { title: string; tone: 'lime' | 'cyan' | 'yellow' | 'magenta'; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className={`panel tone-${props.tone}`}>
      <div className="panel-bar">
        <h2>{props.icon}{props.title}</h2>
        <span className="dots" aria-hidden><i /><i /><i /></span>
      </div>
      <div className="panel-body">{props.children}</div>
    </section>
  );
}
