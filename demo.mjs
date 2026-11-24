import { metrics, videoMetrics } from './metrics.mjs';

// All names, IDs, figures and images in demo mode are fictional.
const seeds = [
  ['Bếp Nhỏ Mỗi Ngày', 'Ẩm thực', 'VN', 28400, 187, 4820000, 'BN', '#de8861'],
  ['Chuyện Của Lá', 'Lối sống', 'VN', 12600, 86, 1920000, 'CL', '#769f7c'],
  ['Đi Và Kể', 'Du lịch', 'VN', 67200, 124, 13800000, 'ĐK', '#6b94b5'],
  ['Cà Phê & Code', 'Công nghệ', 'VN', 18900, 73, 2350000, 'CC', '#9a84ba'],
  ['The Quiet Kitchen', 'Ẩm thực', 'US', 45800, 142, 8640000, 'QK', '#bda56e'],
  ['Slow Sunday', 'Lối sống', 'US', 9800, 64, 1240000, 'SS', '#8a9c88'],
  ['Mộc Studio', 'Lối sống', 'VN', 4320, 38, 682000, 'MS', '#bb8e99'],
  ['Pocket Journeys', 'Du lịch', 'US', 32600, 98, 7230000, 'PJ', '#6ca7a0'],
  ['Góc Bếp Quê', 'Ẩm thực', 'VN', 81500, 264, 21600000, 'BQ', '#c29461'],
  ['Build Something', 'Công nghệ', 'US', 24500, 112, 4820000, 'BS', '#7d8fc4'],
  ['Một Chút Bình Yên', 'Lối sống', 'VN', 7300, 47, 918000, 'BY', '#91a193'],
  ['Little Experiments', 'Công nghệ', 'GB', 16200, 92, 3280000, 'LE', '#b492b9'],
];
export function demoData(now = Date.now()) {
  const ago = days => new Date(now - days * 86400000).toISOString();
  const channels = seeds.map(([title, topic, country, subs, videos, views, initials, color], i) => {
    const item = {id: `demo-channel-${i + 1}`, title, topic, country, subs, videos, views, initials, color,
      description: `Kênh minh họa về ${topic.toLowerCase()}. Dữ liệu giả lập để trải nghiệm tính năng NicheScope.`,
      publishedAt: ago(240 + i * 61), thumbnail: null, url: null, demo: true};
    return {...item, ...metrics(item)};
  });
  const titles = ['Một ngày nấu ăn chậm giữa lòng thành phố', 'Dọn lại góc nhỏ, tìm lại cảm hứng', '48 giờ khám phá một nơi xa lạ', 'Tự làm một công cụ giúp tiết kiệm 2 giờ mỗi ngày', 'A quiet morning in my little kitchen', 'The art of doing less on a Sunday', 'Biến căn phòng nhỏ thành nơi muốn trở về', 'A weekend away from everything', 'Bữa cơm quê chỉ với 50 nghìn đồng', 'I built this with just one simple idea', 'Những điều nhỏ khiến một ngày tốt hơn', 'What happens when you try something new?'];
  const videos = channels.map((c, i) => {
    const item = {id: `demo-video-${i + 1}`, title: titles[i], channelId: c.id, channelTitle: c.title,
      views: [258000, 98200, 412000, 163000, 367000, 124000, 86200, 291000, 642000, 218000, 69300, 182000][i],
      publishedAt: ago([3, 5, 2, 7, 4, 2, 6, 8, 5, 3, 4, 9][i]), duration: 360 + i * 83,
      thumbnail: null, url: null, topic: c.topic, color: c.color, demo: true};
    return {...item, ...videoMetrics(item, c, now)};
  });
  return {channels, videos};
}
