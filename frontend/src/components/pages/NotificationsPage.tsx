import { useNavigate } from 'react-router-dom';
import { NotificationSettings } from '../NotificationSettings';

/**
 * Page-mode wrapper at /settings/notifications. The notification
 * preferences UI is identical, just rendered without the modal
 * overlay. Cancel/save both navigate back to the previous page.
 */
export const NotificationsPage = () => {
  const navigate = useNavigate();
  return <NotificationSettings onClose={() => navigate(-1)} />;
};
