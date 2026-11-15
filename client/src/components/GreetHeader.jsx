import Icon from './Icon.jsx';
import { Avatar } from './adminkit.jsx';
import { useT } from '../lib/i18n.js';
import { useMyPhoto } from '../lib/photo.js';
import { greeting, longDate } from '../lib/schedule.js';
import { useSession } from '../lib/session.jsx';

/**
 * The top of every signed-in home page: the person's avatar (gold ring),
 * "Good morning, <their name>", the page title and small chips (date, stop…).
 * `name` overrides the name in the greeting; `nameInTitle` leaves it out when
 * the title already is the name (the student's home).
 */
export default function GreetHeader({ title, metas, right, nameInTitle = false }) {
  const { user } = useSession();
  const t = useT();
  const name = user?.name ?? '';
  const photo = useMyPhoto();
  return (
    <header className="app-greet">
      <div className="greet-who">
        <Avatar name={name || '?'} size={56} photo={photo} />
        <div>
          <span className="greet-sub">
            {t(greeting())},{nameInTitle ? null : <> <b className="greet-name" data-no-translate>{name}</b></>}
          </span>
          <h1 data-no-translate={nameInTitle || undefined}>{title}</h1>
          <span className="greet-metas">
            {metas ?? <span className="greet-meta"><Icon name="clock" size={14} /> {longDate()}</span>}
          </span>
        </div>
      </div>
      {right}
    </header>
  );
}
