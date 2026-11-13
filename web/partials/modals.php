  <!-- ===== МОДАЛКА ДРУЗЕЙ ===== -->
  <div class="friends-modal hidden" id="friends-modal">
    <div class="friends-modal-backdrop" id="friends-backdrop"></div>
    <div class="friends-modal-box">
      <div class="friends-modal-head">
        <h2 class="friends-modal-title">Друзья</h2>
        <button type="button" class="friends-modal-close" id="friends-close" aria-label="Закрыть">×</button>
      </div>
      <div class="friends-modal-body">
        <div class="friends-pane" id="friends-pane-friends">
        <div class="friends-me" id="friends-me"></div>

        <div class="friends-search-row">
          <div class="friends-search-wrap search-field">
            <?= icon('search', 14, 'search-field-icon') ?>
            <input type="text" id="friends-search" class="friends-search" placeholder="Поиск друзей" autocomplete="off" />
          </div>
          <button type="button" class="friends-add-btn" id="friends-add-btn" title="Добавить друга">
            <?= icon('user-plus', 18) ?>
          </button>
        </div>

        <div class="friends-search-results hidden" id="friends-search-results"></div>

        <div class="friends-code-panel hidden" id="friends-code-panel">
          <div class="friends-code-found hidden" id="friends-code-found"></div>
          <div class="friends-code-actions">
            <button type="button" class="fc-btn primary" id="friends-code-request" disabled>
              <?= icon('user-plus', 14) ?>
              Отправить заявку
            </button>
            <button type="button" class="fc-btn" id="friends-code-profile" disabled>
              <?= icon('user', 14) ?>
              Профиль
            </button>
          </div>
        </div>

        <div class="friends-section" id="friends-incoming-section" style="display:none">
          <button type="button" class="friends-section-toggle open" data-sec="incoming">
            <span class="friends-chevron">▾</span> ЗАЯВКИ <span class="friends-sec-count" id="friends-incoming-count">0</span>
          </button>
          <div class="friends-section-list" id="friends-incoming"></div>
        </div>

        <div class="friends-section">
          <button type="button" class="friends-section-toggle open" data-sec="online">
            <span class="friends-chevron">▾</span> В СЕТИ <span class="friends-sec-count online" id="friends-online-count">0</span>
          </button>
          <div class="friends-section-list" id="friends-online"></div>
        </div>

        <div class="friends-section">
          <button type="button" class="friends-section-toggle open" data-sec="offline">
            <span class="friends-chevron">▾</span> НЕ В СЕТИ <span class="friends-sec-count" id="friends-offline-count">0</span>
          </button>
          <div class="friends-section-list" id="friends-offline"></div>
        </div>
        </div><!-- /friends-pane-friends -->

        <div class="friends-pane hidden" id="friends-pane-notifications">
          <div class="notif-toolbar">
            <div class="notif-filters">
              <button type="button" class="notif-filter active" data-nfilter="all">Все</button>
              <button type="button" class="notif-filter" data-nfilter="unread">Непрочитанные</button>
            </div>
            <div class="notif-actions">
              <button type="button" class="notif-btn" id="notif-read-all">Отметить все</button>
              <button type="button" class="notif-btn danger" id="notif-clear-all">Очистить</button>
            </div>
          </div>
          <div class="notif-list" id="notif-list">
            <div class="friends-empty">Загрузка...</div>
          </div>
        </div>
      </div>
    </div>
  </div>


  <!-- ===== МОДАЛКА ПЕРЕПИСКИ ===== -->
  <div class="chat-modal hidden" id="chat-modal">
    <div class="chat-modal-backdrop" id="chat-backdrop"></div>
    <div class="chat-modal-box">
      <div class="chat-modal-head">
        <div class="chat-peer" id="chat-peer">
          <div class="chat-peer-avatar" id="chat-peer-avatar"></div>
          <div class="chat-peer-info">
            <div class="chat-peer-name" id="chat-peer-name"></div>
            <div class="chat-peer-status" id="chat-peer-status"></div>
          </div>
        </div>
        <button type="button" class="chat-modal-close" id="chat-close" aria-label="Закрыть">×</button>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="chat-empty" id="chat-empty">
          <div class="chat-empty-icon">💬</div>
          <div class="chat-empty-title">Пока нет сообщений</div>
          <div class="chat-empty-sub">Напишите первыми</div>
        </div>
      </div>
      <div class="chat-compose">
        <div class="chat-tools">
          <button type="button" class="chat-tool-btn" id="chat-plus" title="Вложение">
            <?= icon('plus', 18) ?>
          </button>
          <button type="button" class="chat-tool-btn" id="chat-emoji" title="Смайлики">
            <?= icon('smile-face', 18) ?>
          </button>
        </div>
        <input type="text" id="chat-input" class="chat-input" placeholder="Написать сообщение..." maxlength="2000" autocomplete="off" />
        <button type="button" class="chat-send" id="chat-send" title="Отправить">
          <?= icon('send', 18) ?>
        </button>
      </div>
      <div class="chat-emoji-panel hidden" id="chat-emoji-panel"></div>
      <div class="chat-plus-menu hidden" id="chat-plus-menu">
        <button type="button" data-plus="image">📷 Фото / GIF</button>
        <button type="button" data-plus="draw">✏️ Рисунок</button>
        <button type="button" data-plus="game">🎮 Поделиться игрой</button>
      </div>
      <input type="file" id="chat-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />

      <!-- Draw modal -->
      <div class="chat-draw-overlay hidden" id="chat-draw-overlay">
        <div class="chat-draw-box">
          <div class="chat-draw-head">
            <span>Рисунок</span>
            <button type="button" id="chat-draw-close">×</button>
          </div>
          <canvas id="chat-draw-canvas" width="360" height="240"></canvas>
          <div class="chat-draw-tools">
            <input type="color" id="chat-draw-color" value="#ef5b2c" />
            <button type="button" id="chat-draw-clear">Очистить</button>
            <button type="button" id="chat-draw-send">Отправить</button>
          </div>
        </div>
      </div>

      <!-- Share game picker -->
      <div class="chat-game-picker hidden" id="chat-game-picker">
        <div class="chat-game-picker-head">Выберите игру</div>
        <div class="chat-game-picker-list" id="chat-game-picker-list"></div>
      </div>
      <div class="chat-offline-hint hidden" id="chat-offline-hint">Пользователь не в сети — увидит сообщения позже</div>
    </div>
  </div>




  <!-- ===== ВЫБОР ДРУГА ДЛЯ ПОДАРКА ===== -->
  <div class="cart-modal-overlay hidden" id="gift-friend-modal" aria-hidden="true">
    <div class="cart-modal gift-friend-modal">
      <div class="cart-modal-head">
        <h3>Подарок другу</h3>
        <button type="button" class="pub-modal-close" id="gift-friend-close" aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="cart-modal-body">
        <div class="gift-friend-search-wrap friends-search-wrap">
          <?= icon('search-alt', 14) ?>
          <input type="text" id="gift-friend-search" class="friends-search" placeholder="Поиск по имени" autocomplete="off" />
        </div>
        <div class="gift-friend-list" id="gift-friend-list"><div class="loading">Загрузка...</div></div>
      </div>
      <div class="cart-modal-foot">
        <button type="button" class="cart-modal-btn" id="gift-friend-cancel">Отмена</button>
      </div>
    </div>
  </div>

  <!-- ===== МОДАЛКА ПОДТВЕРЖДЕНИЯ ПОКУПКИ ===== -->
  <div class="cart-modal-overlay hidden" id="checkout-modal" aria-hidden="true">
    <div class="cart-modal checkout-modal">
      <div class="cart-modal-head">
        <h3>Подтверждение покупки</h3>
        <button type="button" class="pub-modal-close" id="checkout-modal-close" aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="cart-modal-body">
        <div class="checkout-alert hidden" id="checkout-alert" role="alert"></div>
        <div class="cart-modal-list" id="checkout-modal-list"></div>
        <div class="checkout-total-row">
          <span>К оплате</span>
          <strong id="checkout-modal-total">0 ₽</strong>
        </div>
        <label class="checkout-agree">
          <input type="checkbox" id="checkout-agree-cb" />
          <span>Я согласен(на) с <button type="button" class="auth-consent-link" id="refund-policy-open">условиями покупки и возврата</button></span>
        </label>
      </div>
      <div class="cart-modal-foot">
        <button type="button" class="cart-modal-btn" id="checkout-cancel">Отменить</button>
        <button type="button" class="cart-modal-btn primary" id="checkout-confirm" disabled>Приобрести</button>
      </div>
    </div>
  </div>

  <!-- ===== УСЛОВИЯ ПОКУПКИ / ВОЗВРАТА ===== -->
  <div class="submit-modal hidden" id="refund-policy-modal">
    <div class="submit-modal-backdrop" data-close-refund></div>
    <div class="submit-modal-box privacy-modal-box">
      <div class="submit-modal-head">
        <h2>Условия покупки и возврата</h2>
        <button type="button" class="pub-modal-close" data-close-refund aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body privacy-modal-body">
        <div class="privacy-hero">
          <div class="privacy-hero-ico">
            <?= icon('shield', 22) ?>
          </div>
          <div>
            <div class="privacy-hero-title">CATio — покупки в каталоге</div>
            <div class="privacy-hero-sub">Как работает оплата, доступ к играм и возврат средств</div>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#ef5b2c">
            <?= icon('credit-card', 18) ?>
          </div>
          <div>
            <h4>Оплата</h4>
            <p>Средства списываются с баланса аккаунта CATio. После успешной оплаты игра появляется в вашей библиотеке.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#f0c14b">
            <?= icon('info', 18) ?>
          </div>
          <div>
            <h4>Без автоматического возврата</h4>
            <p>По умолчанию деньги за покупку <strong>не возвращаются</strong>. Покупка считается окончательной после подтверждения.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6ea8fe">
            <?= icon('clock', 18) ?>
          </div>
          <div>
            <h4>Исключение: меньше 3 часов</h4>
            <p>Возврат возможен, если наиграно <strong>меньше 3 часов</strong> и есть веская причина (техническая проблема, несоответствие описанию, случайная покупка и т.п.). Решение принимает поддержка.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6fdf8b">
            <?= icon('message', 18) ?>
          </div>
          <div>
            <h4>Как запросить возврат</h4>
            <p>Напишите в поддержку через профиль, укажите игру и причину. Мы рассмотрим обращение в разумные сроки.</p>
          </div>
        </div>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-refund>Закрыть</button>
      </div>
    </div>
  </div>

  <!-- ===== МОДАЛКА ПРАВИЛ ПУБЛИКАЦИИ ===== -->
  <!-- Нет издательства — нельзя публиковать -->
  <div class="submit-modal hidden" id="no-pub-modal">
    <div class="submit-modal-backdrop" data-close-no-pub></div>
    <div class="submit-modal-box" style="max-width:420px">
      <div class="submit-modal-head">
        <h2>Нужно издательство</h2>
        <button type="button" class="pub-modal-close" data-close-no-pub aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body">
        <p class="no-pub-text">Вы не состоите ни в одном издательстве. Чтобы отправить игру на модерацию, сначала создайте издательство или вступите в существующее.</p>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-no-pub>Отмена</button>
        <button type="button" class="hp-btn-edit" id="no-pub-create">Создать издательство</button>
      </div>
    </div>
  </div>

  <!-- ===== Меню создания ===== -->
  <div class="submit-modal hidden" id="create-menu-modal">
    <div class="submit-modal-backdrop" data-close-create-menu></div>
    <div class="submit-modal-box" style="max-width:420px">
      <div class="submit-modal-head">
        <h2>Создать</h2>
        <button type="button" class="pub-modal-close" data-close-create-menu aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body create-menu-body">
        <button type="button" class="create-menu-item" id="create-menu-game">
          <span class="create-menu-ico" aria-hidden="true">
            <?= icon('gamepad', 20) ?>
          </span>
          <span class="create-menu-txt"><strong>Добавить игру</strong><em>Карточка на модерацию</em></span>
        </button>
        <button type="button" class="create-menu-item" id="create-menu-workshop">
          <span class="create-menu-ico" aria-hidden="true">
            <?= icon('workshop', 20) ?>
          </span>
          <span class="create-menu-txt"><strong>Мастерская</strong><em>Мод или медиа на модерацию</em></span>
        </button>
        <button type="button" class="create-menu-item" id="create-menu-pubs">
          <span class="create-menu-ico" aria-hidden="true">
            <?= icon('home-building', 20) ?>
          </span>
          <span class="create-menu-txt"><strong>Мои издательства</strong><em>Студии и бренды</em></span>
        </button>
      </div>
    </div>
  </div>

  <!-- ===== Мастерская: выбор типа ===== -->
  <div class="submit-modal hidden" id="ws-type-modal">
    <div class="submit-modal-backdrop" data-close-ws-type></div>
    <div class="submit-modal-box" style="max-width:420px">
      <div class="submit-modal-head">
        <h2>Мастерская</h2>
        <button type="button" class="pub-modal-close" data-close-ws-type aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body create-menu-body">
        <button type="button" class="create-menu-item" id="ws-type-mod">
          <span class="create-menu-ico" aria-hidden="true">
            <?= icon('shield-check', 20) ?>
          </span>
          <span class="create-menu-txt"><strong>Загрузить мод</strong><em>Файлы, описание, скриншоты</em></span>
        </button>
        <button type="button" class="create-menu-item" id="ws-type-media">
          <span class="create-menu-ico" aria-hidden="true">
            <?= icon('image', 20) ?>
          </span>
          <span class="create-menu-txt"><strong>Загрузить медиа</strong><em>Скриншоты для игры</em></span>
        </button>
        <button type="button" class="create-menu-item" id="ws-type-asset">
          <span class="create-menu-ico" aria-hidden="true">
            <?= icon('package', 20) ?>
          </span>
          <span class="create-menu-txt"><strong>Загрузить ассет</strong><em>Документы, механики, паки — игра необязательна</em></span>
        </button>
      </div>
    </div>
  </div>

  <!-- ===== Мастерская: форма медиа ===== -->
  <div class="submit-modal hidden" id="ws-media-form-modal">
    <div class="submit-modal-backdrop" data-close-ws-media-form></div>
    <div class="submit-modal-box" style="max-width:520px">
      <div class="submit-modal-head">
        <h2>Загрузка медиа</h2>
        <button type="button" class="pub-modal-close" data-close-ws-media-form aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body">
        <form id="ws-media-form" class="ws-pub-form">
          <label class="ws-field"><span>Название *</span>
            <input type="text" name="title" class="auth-input" required maxlength="80" minlength="2" placeholder="Название набора скриншотов" />
            <span class="field-counter" data-for="title" data-max="80">0 / 80</span>
          </label>
          <label class="ws-field"><span>Игра *</span>
            <select name="game_id" id="ws-media-game" class="settings-select" required>
              <option value="">Выберите игру</option>
            </select>
          </label>
          <label class="ws-field"><span>Описание</span>
            <textarea name="description" class="auth-input settings-textarea" rows="3" maxlength="400" placeholder="Кратко о скриншотах"></textarea>
            <span class="field-counter" data-for="description" data-max="400">0 / 400</span>
          </label>
          <div class="ws-field">
            <span>Изображения *</span>
            <div class="pub-file-card ws-file-card">
              <div class="pub-file-preview pub-file-preview--wide" id="ws-media-files-preview">
                <?= icon('image', 28) ?>
              </div>
              <label class="pub-file-btn" for="ws-media-files">
                <?= icon('upload', 14) ?>
                Выбрать файлы
              </label>
              <input type="file" name="images[]" id="ws-media-files" class="pub-file-input" accept="image/png,image/jpeg,image/webp,image/gif" multiple required />
              <div class="ws-file-hint" id="ws-media-files-hint">До 12 изображений, PNG/JPG/WebP, до 5 МБ каждое</div>
            </div>
          </div>
        </form>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-ws-media-form>Отмена</button>
        <button type="button" class="hp-btn-save" id="ws-media-submit">Отправить на модерацию</button>
      </div>
    </div>
  </div>

  <!-- ===== Мастерская: форма ассета ===== -->
  <div class="submit-modal hidden" id="ws-asset-form-modal">
    <div class="submit-modal-backdrop" data-close-ws-asset-form></div>
    <div class="submit-modal-box" style="max-width:560px">
      <div class="submit-modal-head">
        <h2>Загрузка ассета</h2>
        <button type="button" class="pub-modal-close" data-close-ws-asset-form aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body">
        <form id="ws-asset-form" class="ws-pub-form">
          <label class="ws-field"><span>Название *</span>
            <input type="text" name="title" class="auth-input" required maxlength="80" minlength="2" placeholder="Название ассета / документа / механики" />
            <span class="field-counter" data-for="title" data-max="80">0 / 80</span>
          </label>
          <label class="ws-field"><span>Игра (необязательно)</span>
            <select name="game_id" id="ws-asset-game" class="settings-select">
              <option value="">Без привязки к игре</option>
            </select>
            <span class="settings-hint">Можно опубликовать гайд, реализацию механики или пак без указания игры</span>
          </label>
          <label class="ws-field"><span>Краткое описание</span>
            <input type="text" name="short_description" class="auth-input" maxlength="160" placeholder="Одна строка для карточки" />
            <span class="field-counter" data-for="short_description" data-max="160">0 / 160</span>
          </label>
          <div class="ws-field"><span>Описание *</span>
            <div class="pub-rte" id="ws-asset-rte">
              <div class="pub-rte-toolbar" role="toolbar" aria-label="Форматирование">
                <button type="button" class="pub-rte-btn" data-cmd="bold" title="Жирный"><b>B</b></button>
                <button type="button" class="pub-rte-btn" data-cmd="italic" title="Курсив"><i>I</i></button>
                <button type="button" class="pub-rte-btn" data-cmd="underline" title="Подчёркнутый"><u>U</u></button>
                <span class="pub-rte-sep"></span>
                <button type="button" class="pub-rte-btn" data-cmd="formatBlock" data-val="h2" title="Заголовок">H2</button>
                <button type="button" class="pub-rte-btn" data-cmd="formatBlock" data-val="h3" title="Подзаголовок">H3</button>
                <button type="button" class="pub-rte-btn" data-cmd="formatBlock" data-val="p" title="Абзац">¶</button>
                <span class="pub-rte-sep"></span>
                <button type="button" class="pub-rte-btn" data-cmd="insertUnorderedList" title="Список">• List</button>
                <button type="button" class="pub-rte-btn" data-cmd="insertOrderedList" title="Нумерация">1. List</button>
                <button type="button" class="pub-rte-btn" data-cmd="createLink" title="Ссылка">🔗</button>
                <button type="button" class="pub-rte-btn" data-cmd="removeFormat" title="Сбросить стиль">✕</button>
              </div>
              <div class="pub-rte-editor auth-input" id="ws-asset-desc-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Подробно: что это, зачем, как пользоваться…"></div>
              <textarea class="hidden" name="description" id="ws-asset-desc" required></textarea>
            </div>
          </div>
          <label class="ws-field"><span>Теги</span>
            <input type="text" name="tags" class="auth-input" maxlength="200" placeholder="через запятую: механика, ui, tutorial" />
          </label>
          <div class="ws-field-row">
            <div class="ws-field"><span>Обложка</span>
              <div class="pub-file-card ws-file-card">
                <label class="pub-file-btn" for="ws-asset-cover">
                  <?= icon('upload', 14) ?>
                  Выбрать
                </label>
                <input type="file" name="cover" id="ws-asset-cover" class="pub-file-input" accept="image/png,image/jpeg,image/webp" />
                <div class="ws-file-hint" id="ws-asset-cover-hint">до 5 МБ</div>
              </div>
            </div>
            <div class="ws-field"><span>Баннер</span>
              <div class="pub-file-card ws-file-card">
                <label class="pub-file-btn" for="ws-asset-banner">
                  <?= icon('upload', 14) ?>
                  Выбрать
                </label>
                <input type="file" name="banner" id="ws-asset-banner" class="pub-file-input" accept="image/png,image/jpeg,image/webp" />
                <div class="ws-file-hint" id="ws-asset-banner-hint">до 5 МБ</div>
              </div>
            </div>
          </div>
          <div class="ws-field"><span>Скриншоты / превью</span>
            <div class="pub-file-card ws-file-card">
              <label class="pub-file-btn" for="ws-asset-shots">
                <?= icon('upload', 14) ?>
                Выбрать файлы
              </label>
              <input type="file" name="screenshots[]" id="ws-asset-shots" class="pub-file-input" accept="image/png,image/jpeg,image/webp" multiple />
              <div class="ws-file-hint" id="ws-asset-shots-hint">До 10 шт., до 5 МБ</div>
            </div>
          </div>
          <div class="ws-field"><span>Файл (архив, документ…)</span>
            <div class="pub-file-card ws-file-card">
              <label class="pub-file-btn" for="ws-asset-file">
                <?= icon('upload', 14) ?>
                Выбрать файл
              </label>
              <input type="file" name="asset_file" id="ws-asset-file" class="pub-file-input" accept=".zip,.rar,.7z,.pdf,.txt,.md,.doc,.docx,.json,.unitypackage,.fbx,.blend,.psd" />
              <div class="ws-file-hint" id="ws-asset-file-hint">ZIP / PDF / документ, до 500 МБ</div>
            </div>
          </div>
        </form>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-ws-asset-form>Отмена</button>
        <button type="button" class="hp-btn-save" id="ws-asset-submit">Отправить на модерацию</button>
      </div>
    </div>
  </div>

  <!-- ===== Мастерская: форма мода ===== -->
  <div class="submit-modal hidden" id="ws-mod-form-modal">
    <div class="submit-modal-backdrop" data-close-ws-mod-form></div>
    <div class="submit-modal-box">
      <div class="submit-modal-head">
        <h2>Загрузка мода</h2>
        <button type="button" class="pub-modal-close" data-close-ws-mod-form aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body">
        <form id="ws-mod-form" class="ws-pub-form">
          <label class="ws-field"><span>Название *</span>
            <input type="text" name="title" class="auth-input" required maxlength="80" minlength="2" placeholder="Название мода" />
            <span class="field-counter" data-for="title" data-max="80">0 / 80</span>
          </label>
          <label class="ws-field"><span>Игра *</span>
            <select name="game_id" id="ws-mod-game" class="settings-select" required>
              <option value="">Выберите игру</option>
            </select>
          </label>
          <label class="ws-field"><span>Краткое описание</span>
            <input type="text" name="short_description" class="auth-input" maxlength="120" placeholder="Одна строка для карточки" />
            <span class="field-counter" data-for="short_description" data-max="120">0 / 120</span>
          </label>
          <label class="ws-field"><span>Об этом моде</span>
            <textarea name="about" class="auth-input settings-textarea" rows="3" maxlength="600"></textarea>
            <span class="field-counter" data-for="about" data-max="600">0 / 600</span>
          </label>
          <label class="ws-field"><span>Описание</span>
            <textarea name="description" class="auth-input settings-textarea" rows="4" maxlength="2000"></textarea>
            <span class="field-counter" data-for="description" data-max="2000">0 / 2000</span>
          </label>
          <label class="ws-field"><span>Инструкция по установке</span>
            <textarea name="install_instructions" class="auth-input settings-textarea" rows="3" maxlength="1000"></textarea>
            <span class="field-counter" data-for="install_instructions" data-max="1000">0 / 1000</span>
          </label>
          <label class="ws-field"><span>Основные характеристики</span>
            <textarea name="features" class="auth-input settings-textarea" rows="2" maxlength="500" placeholder="По одному пункту на строку"></textarea>
            <span class="field-counter" data-for="features" data-max="500">0 / 500</span>
          </label>
          <label class="ws-field"><span>Зависимости</span>
            <textarea name="dependencies" class="auth-input settings-textarea" rows="2" maxlength="400"></textarea>
            <span class="field-counter" data-for="dependencies" data-max="400">0 / 400</span>
          </label>
          <label class="ws-field"><span>Путь установки файлов</span>
            <input type="text" name="install_path" class="auth-input" maxlength="200" placeholder="например Data/Meshes/..." />
          </label>
          <label class="ws-field"><span>Теги</span>
            <input type="text" name="tags" class="auth-input" maxlength="120" placeholder="через запятую, до 8 тегов" />
          </label>
          <div class="ws-field-row">
            <div class="ws-field"><span>Обложка</span>
              <div class="pub-file-card ws-file-card">
                <label class="pub-file-btn" for="ws-mod-cover">
                  <?= icon('upload', 14) ?>
                  Выбрать
                </label>
                <input type="file" name="cover" id="ws-mod-cover" class="pub-file-input" accept="image/png,image/jpeg,image/webp" />
                <div class="ws-file-hint" id="ws-mod-cover-hint">до 5 МБ</div>
              </div>
            </div>
            <div class="ws-field"><span>Баннер</span>
              <div class="pub-file-card ws-file-card">
                <label class="pub-file-btn" for="ws-mod-banner">
                  <?= icon('upload', 14) ?>
                  Выбрать
                </label>
                <input type="file" name="banner" id="ws-mod-banner" class="pub-file-input" accept="image/png,image/jpeg,image/webp" />
                <div class="ws-file-hint" id="ws-mod-banner-hint">до 5 МБ</div>
              </div>
            </div>
          </div>
          <div class="ws-field"><span>Скриншоты</span>
            <div class="pub-file-card ws-file-card">
              <label class="pub-file-btn" for="ws-mod-shots">
                <?= icon('upload', 14) ?>
                Выбрать файлы
              </label>
              <input type="file" name="screenshots[]" id="ws-mod-shots" class="pub-file-input" accept="image/png,image/jpeg,image/webp" multiple />
              <div class="ws-file-hint" id="ws-mod-shots-hint">До 10 шт., до 5 МБ</div>
            </div>
          </div>
          <div class="ws-field"><span>Файл мода *</span>
            <div class="pub-file-card ws-file-card">
              <label class="pub-file-btn" for="ws-mod-file">
                <?= icon('upload', 14) ?>
                Выбрать архив
              </label>
              <input type="file" name="mod_file" id="ws-mod-file" class="pub-file-input" accept=".zip,.rar,.7z,.pak,.mod,application/zip" required />
              <div class="ws-file-hint" id="ws-mod-file-hint">ZIP / RAR / 7Z, до 500 МБ</div>
            </div>
          </div>
        </form>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-ws-mod-form>Отмена</button>
        <button type="button" class="hp-btn-save" id="ws-mod-submit">Отправить на модерацию</button>
      </div>
    </div>
  </div>

  <!-- ===== Просмотр медиа ===== -->
  <div class="submit-modal hidden" id="ws-media-view-modal">
    <div class="submit-modal-backdrop" data-close-ws-media-view></div>
    <div class="submit-modal-box ws-view-box ws-media-view-box">
      <div class="submit-modal-head">
        <h2 id="ws-mv-title">Медиа</h2>
        <button type="button" class="pub-modal-close" data-close-ws-media-view aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body">
        <div class="ws-gallery" id="ws-mv-gallery">
          <div class="ws-gallery-main" id="ws-mv-main">
            <img id="ws-mv-img" alt="" />
          </div>
          <div class="ws-gallery-thumbs" id="ws-mv-thumbs"></div>
        </div>
        <div class="ws-modv-section">
          <h3>Описание</h3>
          <div class="ws-modv-text" id="ws-mv-desc"></div>
        </div>
        <div class="ws-modv-meta-row ws-mv-meta">
          <span id="ws-mv-date"></span>
          <span id="ws-mv-author"></span>
          <span id="ws-mv-views"></span>
          <button type="button" class="ws-like-btn" id="ws-mv-like">♥ <span>0</span></button>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== Просмотр мода ===== -->
  <div class="submit-modal hidden" id="ws-mod-view-modal">
    <div class="submit-modal-backdrop" data-close-ws-mod-view></div>
    <div class="submit-modal-box ws-view-box ws-mod-view-box">
      <div class="ws-modv-page">
        <div class="hp-hero ws-modv-hero" id="ws-modv-hero">
          <div class="hp-hero-bg" id="ws-modv-bg"></div>
          <div class="hp-banner">
            <div class="ws-modv-banner-inner">
              <h1 class="ws-modv-title" id="ws-modv-title">Мод</h1>
            </div>
            <button type="button" class="pub-modal-close ws-modv-close" data-close-ws-mod-view aria-label="Закрыть">
              <?= icon('x', 18) ?>
            </button>
          </div>
          <div class="hp-toolbar ws-modv-toolbar">
            <div class="ws-modv-stats" id="ws-modv-stats">
              <span class="ws-modv-stat" id="ws-modv-views"><?= icon('eye', 14) ?> <b>0</b></span>
              <span class="ws-modv-stat" id="ws-modv-dls"><?= icon('downloads', 14) ?> <b>0</b></span>
              <span class="ws-modv-stat" id="ws-modv-likes"><?= icon('heart', 14) ?> <b>0</b></span>
            </div>
            <div class="ws-modv-toolbar-right" id="ws-modv-actions">
              <button type="button" class="hp-btn-save ws-modv-install" id="ws-modv-install">Установить</button>
            </div>
          </div>
        </div>
        <div class="ws-modv-body">
          <div class="ws-gallery ws-gallery--thumbs-only" id="ws-modv-gallery">
            <div class="ws-gallery-main" id="ws-modv-main" hidden></div>
            <div class="ws-gallery-thumbs" id="ws-modv-thumbs"></div>
          </div>
          <div class="ws-modv-section">
            <h3>Описание</h3>
            <div class="ws-modv-text" id="ws-modv-desc"></div>
          </div>
          <div class="ws-modv-section" id="ws-modv-about-wrap">
            <h3>Об этом моде</h3>
            <div class="ws-modv-text" id="ws-modv-about"></div>
          </div>
          <div class="ws-modv-section" id="ws-modv-install-wrap">
            <h3>Инструкция по установке</h3>
            <div class="ws-modv-text" id="ws-modv-install-txt"></div>
          </div>
          <div class="ws-modv-section" id="ws-modv-feat-wrap">
            <h3>Основные характеристики</h3>
            <div class="ws-modv-text" id="ws-modv-feat"></div>
          </div>
          <div class="ws-modv-section" id="ws-modv-deps-wrap">
            <h3>Зависимости</h3>
            <div class="ws-modv-text" id="ws-modv-deps"></div>
          </div>
          <div class="ws-modv-meta-row">
            <span id="ws-modv-author"></span>
            <span id="ws-modv-game"></span>
            <button type="button" class="ws-like-btn" id="ws-modv-like">♥ <span>0</span></button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== Просмотр ассета ===== -->
  <div class="submit-modal hidden" id="ws-asset-view-modal">
    <div class="submit-modal-backdrop" data-close-ws-asset-view></div>
    <div class="submit-modal-box ws-view-box ws-asset-view-box">
      <div class="submit-modal-head ws-assetv-head">
        <h2 class="ws-assetv-title" id="ws-assetv-title">Ассет</h2>
        <button type="button" class="pub-modal-close" data-close-ws-asset-view aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="ws-assetv-split">
        <div class="ws-assetv-left">
          <div class="gp-gallery" id="ws-assetv-gallery">
            <div class="gp-gallery-viewport">
              <div class="gp-gallery-main" id="ws-assetv-main">
                <img id="ws-assetv-main-img" alt="" />
              </div>
            </div>
            <div class="gp-gallery-thumbs" id="ws-assetv-thumbs"></div>
          </div>
          <div class="gp-section gp-section-builds" id="ws-assetv-files-wrap">
            <h2 class="gp-block-title">Сборки и файлы</h2>
            <div id="ws-assetv-files" class="ws-asset-files modal-builds"></div>
            <div class="ws-assetv-meta">
              <span id="ws-assetv-author"></span>
              <span id="ws-assetv-game"></span>
              <span class="ws-assetv-statline" id="ws-assetv-stats-line"></span>
              <button type="button" class="ws-like-btn" id="ws-assetv-like">♥ <span>0</span></button>
            </div>
          </div>
        </div>
        <div class="ws-assetv-right">
          <h2 class="gp-block-title">Об ассете</h2>
          <div class="gp-description" id="ws-assetv-desc"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Нет игры для мода -->
  <div class="submit-modal hidden" id="ws-mod-no-game-modal">
    <div class="submit-modal-backdrop" data-close-ws-mod-nogame></div>
    <div class="submit-modal-box app-confirm-box" style="max-width:440px">
      <div class="submit-modal-body app-confirm-body" style="text-align:left">
        <h2 class="app-confirm-title" style="text-align:left">Игра не найдена</h2>
        <p class="app-confirm-sub" style="text-align:left;margin-bottom:16px" id="ws-mod-nogame-text">У вас нет игры для этой модификации. Автоматическая установка невозможна, но можно скачать файл и установить вручную.</p>
        <div class="app-confirm-actions" style="justify-content:flex-end;flex-wrap:wrap">
          <button type="button" class="hp-btn-edit" data-close-ws-mod-nogame>Отмена</button>
          <button type="button" class="hp-btn-edit" id="ws-mod-nogame-buy">Купить</button>
          <button type="button" class="hp-btn-save" id="ws-mod-nogame-manual">Ручная установка</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== Список издательств ===== -->
  <div class="submit-modal hidden" id="pubs-list-modal">
    <div class="submit-modal-backdrop" data-close-pubs-list></div>
    <div class="submit-modal-box" style="max-width:480px">
      <div class="submit-modal-head">
        <h2>Мои издательства</h2>
        <button type="button" class="pub-modal-close" data-close-pubs-list aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body">
        <div id="pubs-list" class="pubs-list"><div class="loading">Загрузка...</div></div>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close-pubs-list>Закрыть</button>
        <button type="button" class="hp-btn-edit" id="pubs-create-open">Создать издательство</button>
      </div>
    </div>
  </div>

  <!-- ===== Создание издательства ===== -->
  <div class="submit-modal hidden" id="pubs-create-modal">
    <div class="submit-modal-backdrop" data-close-pubs-create></div>
    <div class="submit-modal-box pubs-create-box">
      <div class="submit-modal-head pub-modal-head">
        <div>
          <h2>Новое издательство</h2>
          <p class="pub-modal-sub">Аватар, баннер, описание и участники</p>
        </div>
        <button type="button" class="pub-modal-close" data-close-pubs-create aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body pub-modal-body">
        <div class="submit-grid pubs-create-grid">
          <label class="settings-label full">
            <span>Название *</span>
            <input class="auth-input" id="pub-name" maxlength="60" minlength="2" placeholder="Например: Neon Fox Games" autocomplete="off" />
            <span class="field-counter" id="pub-name-count">0 / 60</span>
          </label>
          <label class="settings-label full">
            <span>Описание</span>
            <textarea class="auth-input settings-textarea" id="pub-desc" rows="3" maxlength="300" placeholder="Коротко о студии"></textarea>
            <span class="field-counter" id="pub-desc-count">0 / 300</span>
          </label>
          <div class="settings-label">
            <span>Аватар</span>
            <div class="pub-file-card" style="margin-top:6px">
              <div class="pub-file-preview pub-file-preview--icon" id="pub-avatar-preview">
                <?= icon('user-circle', 28) ?>
              </div>
              <label class="pub-file-btn" for="pub-avatar">
                <?= icon('upload', 14) ?>
                Выбрать
              </label>
              <input type="file" id="pub-avatar" class="pub-file-input" accept="image/*" />
            </div>
          </div>
          <div class="settings-label">
            <span>Обложка / баннер</span>
            <div class="pub-file-card" style="margin-top:6px">
              <div class="pub-file-preview pub-file-preview--wide" id="pub-banner-preview">
                <?= icon('image-alt', 32) ?>
              </div>
              <label class="pub-file-btn" for="pub-banner">
                <?= icon('upload', 14) ?>
                Выбрать
              </label>
              <input type="file" id="pub-banner" class="pub-file-input" accept="image/*" />
            </div>
          </div>
          <div class="settings-label full">
            <span>Участники</span>
            <div class="search-field" style="margin-top:6px">
              <?= icon('search', 14, 'search-field-icon') ?>
              <input class="auth-input" id="pub-member-search" placeholder="Поиск пользователя…" autocomplete="off" />
            </div>
            <div id="pub-member-suggest" class="pub-member-suggest hidden"></div>
            <div id="pub-member-chips" class="pub-member-chips"></div>
          </div>
        </div>
      </div>
      <div class="submit-modal-foot pubs-create-foot">
        <button type="button" class="hp-btn-edit" data-close-pubs-create>Отмена</button>
        <button type="button" class="hp-btn-save" id="pub-create-save">Создать</button>
      </div>
    </div>
  </div>

  <div class="submit-modal hidden" id="submit-rules-modal">
    <div class="submit-modal-backdrop" data-close="rules"></div>
    <div class="submit-modal-box privacy-modal-box">
      <div class="submit-modal-head">
        <h2>Правила публикации</h2>
        <button type="button" class="pub-modal-close" data-close="rules" aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body privacy-modal-body">
        <div class="privacy-hero">
          <div class="privacy-hero-ico">
            <?= icon('shield', 22) ?>
          </div>
          <div>
            <div class="privacy-hero-title">CATio — правила каталога</div>
            <div class="privacy-hero-sub">Коротко о том, что можно публиковать и как проходит модерация</div>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#ef5b2c">
            <?= icon('shield', 18) ?>
          </div>
          <div>
            <h4>Права на контент</h4>
            <p>Загружайте только игры, на которые у вас есть права. Запрещены кражи чужого контента и вредоносные файлы.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6ea8fe">
            <?= icon('image', 18) ?>
          </div>
          <div>
            <h4>Обложка и описание</h4>
            <p>Обложка, скриншоты и текст должны соответствовать игре. NSFW — только с явной пометкой 18+.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6fdf8b">
            <?= icon('check-square', 18) ?>
          </div>
          <div>
            <h4>Модерация</h4>
            <p>После отправки игра проходит проверку. Админ может поправить материалы перед публикацией или отклонить заявку.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#f0c14b">
            <?= icon('info', 18) ?>
          </div>
          <div>
            <h4>Ответственность</h4>
            <p>Нарушение правил может привести к отклонению заявки и ограничению публикации для аккаунта.</p>
          </div>
        </div>
        <label class="settings-check" style="margin-top:14px">
          <input type="checkbox" id="submit-agree" />
          Я согласен(на) с правилами публикации
        </label>
      </div>
      <div class="submit-modal-foot">
        <button type="button" class="hp-btn-edit" data-close="rules">Отмена</button>
        <button type="button" class="hp-btn-edit" id="submit-rules-next" disabled>Дальше</button>
      </div>
    </div>
  </div>

    <!-- ===== МОДАЛКА АНКЕТЫ ИГРЫ (restored simple) ===== -->
<!-- ===== МОДАЛКА АНКЕТЫ ИГРЫ ===== -->
    <div class="submit-modal hidden" id="submit-form-modal">
    <div class="submit-modal-backdrop" data-close="form"></div>
    <div class="submit-modal-box submit-modal-wide pub-modal-box">
      <div class="submit-modal-head pub-modal-head">
        <div>
          <h2>Публикация игры</h2>
          <p class="pub-modal-sub">Заполните карточку игры — жанры, медиа, требования и описание</p>
        </div>
        <button type="button" class="pub-modal-close" data-close="form" aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body pub-modal-body">
        <form id="submit-game-form" class="submit-form pub-form">

          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><?= icon('library', 16) ?></span>
              <h3>Основное</h3>
            </div>
            <div class="submit-grid">
              <label class="settings-label"><span>Название *</span><input class="auth-input" name="title" id="sg-title" required maxlength="120" /></label>
              <label class="settings-label"><span>Цена (₽)</span><input class="auth-input" name="price" id="sg-price" type="text" inputmode="numeric" pattern="[0-9]*" value="0" maxlength="7" autocomplete="off" /></label>
              <label class="settings-label"><span>Разработчик</span><input class="auth-input" name="developer" id="sg-developer" maxlength="120" placeholder="Студия или автор" /></label>
              <label class="settings-label sg-pub-field">
                <div class="sg-pub-label-row">
                  <span class="sg-pub-label-title">Издательство</span>
                  <span class="sg-pub-admin-hint" hidden></span>
                </div>
                <select class="settings-select" id="sg-publisher-id" name="publisher_id">
                  <option value="">— без издательства —</option>
                </select>
              </label>
              <input type="hidden" name="publisher" id="sg-publisher" value="" />
              <label class="settings-label"><span>Дата релиза</span><input class="auth-input" name="release_date" id="sg-release" type="date" /></label>
              <label class="settings-label"><span>Сайт / страница</span><input class="auth-input" name="website" id="sg-website" type="url" placeholder="https://" maxlength="255" /></label>
              <label class="settings-label full"><span>Краткое описание</span><input class="auth-input" name="short_description" id="sg-short" maxlength="200" placeholder="Одна строка для карточки в каталоге" /></label>
              <div class="settings-label full">
                <span>Жанры * <em class="pub-field-hint">можно несколько</em></span>
                <div class="pub-genre-grid" id="sg-genre-grid">
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Экшен" /><span>Экшен</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Приключения" /><span>Приключения</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="RPG" /><span>RPG</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Стратегия" /><span>Стратегия</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Симулятор" /><span>Симулятор</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Инди" /><span>Инди</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Хоррор" /><span>Хоррор</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Гонки" /><span>Гонки</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Спорт" /><span>Спорт</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Шутер" /><span>Шутер</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Платформер" /><span>Платформер</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Головоломка" /><span>Головоломка</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Выживание" /><span>Выживание</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Открытый мир" /><span>Открытый мир</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Мультиплеер" /><span>Мультиплеер</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Казуальная" /><span>Казуальная</span></label>
                  <label class="pub-genre-chip"><input type="checkbox" class="sg-genre" value="Другое" /><span>Другое</span></label>
                </div>
                <input type="hidden" name="genre" id="sg-genre" value="" />
              </div>
              <label class="settings-label full"><span>Теги</span><input class="auth-input" name="tags" id="sg-tags" maxlength="200" placeholder="через запятую: pixel-art, co-op, roguelike…" /></label>
              <div class="settings-label full">
                <span>Платформы</span>
                <div class="submit-checks pub-platform-checks">
                  <label class="settings-check"><input type="checkbox" class="sg-platform" value="windows" checked /> Windows</label>
                  <label class="settings-check"><input type="checkbox" class="sg-platform" value="linux" /> Linux</label>
                  <label class="settings-check"><input type="checkbox" class="sg-platform" value="mac" /> macOS</label>
                </div>
              </div>
              <div class="settings-label full">
                <span>Описание * <em class="pub-field-hint">форматирование как в Steam</em></span>
                <div class="pub-rte" id="sg-rte">
                  <div class="pub-rte-toolbar" role="toolbar" aria-label="Форматирование">
                    <button type="button" class="pub-rte-btn" data-cmd="bold" title="Жирный"><b>B</b></button>
                    <button type="button" class="pub-rte-btn" data-cmd="italic" title="Курсив"><i>I</i></button>
                    <button type="button" class="pub-rte-btn" data-cmd="underline" title="Подчёркнутый"><u>U</u></button>
                    <span class="pub-rte-sep"></span>
                    <button type="button" class="pub-rte-btn" data-cmd="formatBlock" data-val="h2" title="Заголовок">H2</button>
                    <button type="button" class="pub-rte-btn" data-cmd="formatBlock" data-val="h3" title="Подзаголовок">H3</button>
                    <button type="button" class="pub-rte-btn" data-cmd="formatBlock" data-val="p" title="Абзац">¶</button>
                    <span class="pub-rte-sep"></span>
                    <button type="button" class="pub-rte-btn" data-cmd="insertUnorderedList" title="Список">• List</button>
                    <button type="button" class="pub-rte-btn" data-cmd="insertOrderedList" title="Нумерация">1. List</button>
                    <button type="button" class="pub-rte-btn" data-cmd="indent" title="Отступ →">→</button>
                    <button type="button" class="pub-rte-btn" data-cmd="outdent" title="Отступ ←">←</button>
                    <span class="pub-rte-sep"></span>
                    <button type="button" class="pub-rte-btn" data-cmd="createLink" title="Ссылка">🔗</button>
                    <button type="button" class="pub-rte-btn" data-cmd="insertHorizontalRule" title="Линия">―</button>
                    <button type="button" class="pub-rte-btn" data-cmd="removeFormat" title="Сбросить стиль">✕</button>
                    <span class="pub-rte-sep"></span>
                    <button type="button" class="pub-rte-btn" data-cmd="insertShot" title="Вставить скриншот">🖼 Скрин</button>
                  </div>
                  <div class="pub-rte-editor auth-input" id="sg-desc-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Подробное описание игры…"></div>
                  <textarea class="hidden" name="description" id="sg-desc" required></textarea>
                </div>
              </div>
            </div>
          </section>

          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><?= icon('image', 16) ?></span>
              <h3>Медиа</h3>
            </div>
            <div class="pub-media-grid">
              <div class="pub-file-card" data-for="sg-cover">
                <div class="pub-file-preview" id="sg-cover-preview"><span>Обложка *</span></div>
                <label class="pub-file-btn" for="sg-cover">Выбрать файл</label>
                <input type="file" name="cover" id="sg-cover" class="pub-file-input" accept="image/*" />
                <div class="pub-file-name" id="sg-cover-name">PNG / JPG, 600×900</div>
              </div>
              <div class="pub-file-card" data-for="sg-banner">
                <div class="pub-file-preview pub-file-preview--wide" id="sg-banner-preview"><span>Баннер / шапка</span></div>
                <label class="pub-file-btn" for="sg-banner">Выбрать файл</label>
                <input type="file" name="banner" id="sg-banner" class="pub-file-input" accept="image/*" />
                <div class="pub-file-name" id="sg-banner-name">Широкий баннер</div>
              </div>
              <div class="pub-file-card" data-for="sg-logo">
                <div class="pub-file-preview pub-file-preview--logo" id="sg-logo-preview"><span>Логотип</span></div>
                <label class="pub-file-btn" for="sg-logo">Выбрать файл</label>
                <input type="file" name="logo" id="sg-logo" class="pub-file-input" accept="image/*" />
                <div class="pub-file-name" id="sg-logo-name">Прозрачный PNG</div>
              </div>
              <div class="pub-file-card" data-for="sg-icon">
                <div class="pub-file-preview pub-file-preview--icon" id="sg-icon-preview"><span>Иконка</span></div>
                <label class="pub-file-btn" for="sg-icon">Выбрать файл</label>
                <input type="file" name="icon" id="sg-icon" class="pub-file-input" accept="image/*" />
                <div class="pub-file-name" id="sg-icon-name">Квадрат 256×256</div>
              </div>
            </div>
            <div class="settings-label full" style="margin-top:12px">
              <span>Скриншоты</span>
              <div class="pub-shots-row">
                <label class="pub-file-btn" for="sg-shots">Выбрать скриншоты</label>
                <input type="file" name="screenshots[]" id="sg-shots" class="pub-file-input" accept="image/*" multiple />
                <div class="pub-shots-preview" id="sg-shots-preview"></div>
              </div>
            </div>
            <div class="settings-label full" id="sg-trailers-wrap" style="margin-top:10px"></div>
            <input type="hidden" name="cover_url" id="sg-cover-url" />
              <input type="hidden" name="screenshot_urls" id="sg-screenshots-urls" />
              <input type="hidden" name="icon_url" id="sg-icon-url" />
              <input type="hidden" name="logo_url" id="sg-logo-url" />
            <input type="hidden" name="banner_url" id="sg-banner-url" />
          </section>

          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><?= icon('monitor', 16) ?></span>
              <h3>Системные требования</h3>
            </div>
            <div class="settings-label full">
              <span>Минимальные</span>
              <div class="sysreq-fields" id="sg-sys-min-fields">
                <input class="auth-input" data-k="os" placeholder="ОС" />
                <input class="auth-input" data-k="processor" placeholder="Процессор" />
                <input class="auth-input" data-k="memory" placeholder="Оперативная память" />
                <input class="auth-input" data-k="gpu" placeholder="Видеокарта" />
                <input class="auth-input" data-k="directx" placeholder="DirectX" />
                <input class="auth-input" data-k="storage" placeholder="Место на диске" />
                <input class="auth-input" data-k="sound" placeholder="Звуковая карта" />
                <input class="auth-input" data-k="other" placeholder="Дополнительно" />
              </div>
            </div>
            <div class="settings-label full" style="margin-top:10px">
              <span>Рекомендуемые</span>
              <div class="sysreq-fields" id="sg-sys-rec-fields">
                <input class="auth-input" data-k="os" placeholder="ОС" />
                <input class="auth-input" data-k="processor" placeholder="Процессор" />
                <input class="auth-input" data-k="memory" placeholder="Оперативная память" />
                <input class="auth-input" data-k="gpu" placeholder="Видеокарта" />
                <input class="auth-input" data-k="directx" placeholder="DirectX" />
                <input class="auth-input" data-k="storage" placeholder="Место на диске" />
                <input class="auth-input" data-k="sound" placeholder="Звуковая карта" />
                <input class="auth-input" data-k="other" placeholder="Дополнительно" />
              </div>
            </div>
          </section>

          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><?= icon('edit', 16) ?></span>
              <h3>Языки и управление</h3>
            </div>
            <div class="settings-label full">
              <span>Поддержка контроллеров</span>
              <div class="submit-checks">
                <label class="settings-check"><input type="checkbox" value="xbox" class="sg-ctrl" /> Xbox</label>
                <label class="settings-check"><input type="checkbox" value="playstation" class="sg-ctrl" /> PlayStation</label>
                <label class="settings-check"><input type="checkbox" value="switch" class="sg-ctrl" /> Switch</label>
                <label class="settings-check"><input type="checkbox" value="keyboard" class="sg-ctrl" /> Клавиатура</label>
              </div>
            </div>
            <div class="settings-label full">
              <span>Языки</span>
              <div class="lang-table" id="sg-lang-table">
                <div class="lang-table-head"><span>Язык</span><span>Субтитры</span><span>Аудио</span></div>
              </div>
            </div>
          </section>

          <section class="pub-section" id="sg-builds-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><?= icon('downloads', 16) ?></span>
              <h3>Сборка и файл</h3>
            </div>
            <p class="pub-hint">Укажите версию, кратко что нового и прикрепите файл (zip/exe). Без этого на модерацию не отправится.</p>
            <div class="ws-ff" style="margin-bottom:10px">
              <span>Версия *</span>
              <input type="text" class="auth-input" id="sg-build-version" name="build_version" placeholder="1.0.0" maxlength="32" />
            </div>
            <div class="ws-ff" style="margin-bottom:10px">
              <span>Что нового</span>
              <input type="text" class="auth-input" id="sg-build-changelog" name="build_changelog" placeholder="Кратко об изменениях…" maxlength="500" />
            </div>
            <div class="ws-ff" style="margin-bottom:10px">
              <span>Файл *</span>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <label class="pub-file-btn" for="sg-build-file">Выбрать файл</label>
                <input type="file" id="sg-build-file" class="pub-file-input" name="build_file" accept=".exe,.zip,.7z,.rar,.msi,.dmg,.appimage,.tar,.gz" hidden />
                <span class="settings-hint" id="sg-build-file-name">ZIP / EXE / 7z…</span>
              </div>
              <div id="sg-build-existing" class="settings-hint" style="display:none;margin-top:8px"></div>
            </div>
          </section>

          <section class="pub-section">
            <div class="pub-section-head">
              <span class="pub-section-ico"><?= icon('alert', 16) ?></span>
              <h3>Специфический контент</h3>
            </div>
            <p class="pub-hint">Отметьте, если в игре есть возрастной или чувствительный материал</p>
            <div class="pub-content-flags">
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="adult" id="sg-adult" /><span>18+ / для взрослых</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="violence" /><span>Насилие</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="gore" /><span>Жестокость / кровь</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="drugs" /><span>Наркотики / алкоголь</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="language" /><span>Ненормативная лексика</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="horror" /><span>Хоррор / пугающий контент</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="gambling" /><span>Азартные механики</span></label>
              <label class="pub-flag"><input type="checkbox" class="sg-content-flag" value="prohibited" /><span>Запрещённые темы</span></label>
            </div>
          </section>

        </form>
      </div>
      <div class="submit-modal-foot">
        <div class="submit-foot-left">
          <input type="file" id="sg-import-pack" accept=".zip,application/zip" hidden />
          <button type="button" class="hp-btn-edit" id="sg-import-pack-btn" title="Импорт ZIP-пакета игры">Импорт</button>
        </div>
        <div class="submit-foot-right">
          <button type="button" class="hp-btn-edit" data-close="form">Отмена</button>
          <button type="button" class="hp-btn-save" id="submit-game-send">Отправить на модерацию</button>
        </div>
      </div>
    </div>
  </div>


<div class="submit-modal hidden" id="submit-done-modal">
    <div class="submit-modal-backdrop" data-close="done"></div>
    <div class="submit-modal-box submit-done-box">
      <div class="submit-modal-body submit-done-body">
        <div class="submit-done-icon" aria-hidden="true">
          <?= icon('send-outline', 48) ?>
        </div>
        <h2 class="submit-done-title">Игра отправлена на рассмотрение</h2>
        <p class="submit-done-sub">Спасибо! Администраторы проверят материалы и опубликуют игру или свяжутся с вами.</p>
        <button type="button" class="hp-btn-save submit-done-btn" data-close="done">Отлично</button>
      </div>
    </div>
  </div>

  <!-- Универсальная confirm-модалка -->
  <div class="submit-modal hidden" id="app-confirm-modal">
    <div class="submit-modal-backdrop" data-confirm-cancel></div>
    <div class="submit-modal-box app-confirm-box">
      <div class="submit-modal-body app-confirm-body">
        <div class="app-confirm-icon" id="app-confirm-icon" aria-hidden="true">
          <?= icon('trash', 44) ?>
        </div>
        <h2 class="app-confirm-title" id="app-confirm-title">Подтверждение</h2>
        <p class="app-confirm-sub" id="app-confirm-sub"></p>
        <div class="app-confirm-pin hidden" id="app-confirm-pin" aria-label="Ввод кода друга">
          <p class="app-confirm-pin-hint" id="app-confirm-pin-hint">Введите свой код друга</p>
          <div class="app-confirm-pin-cells" id="app-confirm-pin-cells"></div>
          <p class="app-confirm-pin-error hidden" id="app-confirm-pin-error">Неверный код</p>
        </div>
        <div class="app-confirm-actions">
          <button type="button" class="hp-btn-edit" id="app-confirm-cancel" data-confirm-cancel>Отмена</button>
          <button type="button" class="hp-btn-save app-confirm-ok" id="app-confirm-ok">OK</button>
        </div>
      </div>
    </div>
  </div>


  <!-- ===== 18+ GATE ===== -->
  <div class="adult-gate hidden" id="adult-gate-modal">
    <div class="adult-gate-backdrop"></div>
    <div class="adult-gate-box" role="dialog" aria-modal="true">
      <div class="adult-gate-head">
        <h2>Эта игра содержит неприемлемый контент</h2>
        <button type="button" class="friends-modal-close" id="adult-gate-x" aria-label="Закрыть">×</button>
      </div>
      <div class="adult-gate-body">
        <p><strong id="adult-gate-title">Игра</strong> содержит контент, который может не подходить для всех возрастов. Вы уверены, что хотите продолжить?</p>
      </div>
      <div class="adult-gate-foot">
        <button type="button" class="adult-gate-back" id="adult-gate-back">Назад</button>
        <button type="button" class="adult-gate-continue" id="adult-gate-continue">Продолжить</button>
      </div>
    </div>
  </div>

  <!-- ===== АДМИН: РЕДАКТИРОВАНИЕ ПОЛЬЗОВАТЕЛЯ ===== -->
  <div class="submit-modal hidden" id="admin-user-modal">
    <div class="submit-modal-backdrop" data-close-admin-user></div>
    <div class="submit-modal-box submit-modal-wide" role="dialog" aria-modal="true">
      <div class="submit-modal-head">
        <h2>Редактирование пользователя</h2>
        <button type="button" class="friends-modal-close" id="admin-user-close" aria-label="Закрыть">×</button>
      </div>
      <div class="submit-modal-body" id="admin-user-body">
        <input type="hidden" id="admin-user-id" value="" />
        <label class="settings-label"><span>Ник</span><input type="text" id="admin-user-name" maxlength="32" /></label>
        <label class="settings-label"><span>Роль</span>
          <select id="admin-user-role">
            <option value="user">user</option>
            <option value="developer">developer</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label class="settings-label"><span>Баланс</span><input type="number" id="admin-user-balance" min="0" step="1" /></label>
        <label class="settings-label"><span>Карма</span><input type="number" id="admin-user-karma" step="1" /></label>
        <label class="settings-label"><span>Цвет аватара</span><input type="color" id="admin-user-color" value="#ef5b2c" /></label>
        <div class="admin-user-media-row">
          <label class="settings-label"><span>Новый аватар</span><input type="file" id="admin-user-avatar" accept="image/*" /></label>
          <label class="settings-label"><span>Новая шапка</span><input type="file" id="admin-user-banner" accept="image/*" /></label>
        </div>
        <hr class="admin-user-hr" />
        <h3 class="admin-user-ban-title">Бан</h3>
        <label class="settings-label"><span>Причина бана</span><input type="text" id="admin-user-ban-reason" placeholder="Нарушение правил…" /></label>
        <label class="settings-label"><span>Срок (дней, 0 = навсегда)</span><input type="number" id="admin-user-ban-days" min="0" value="0" /></label>
        <div class="admin-user-actions">
          <button type="button" class="auth-submit" id="admin-user-save">Сохранить</button>
          <button type="button" class="btn-danger" id="admin-user-ban">Забанить</button>
          <button type="button" class="hp-btn-edit" id="admin-user-unban">Разбанить</button>
        </div>
        <p class="comment-hint" id="admin-user-status"></p>
      </div>
    </div>
  </div>

  <?php if ($banInfo): ?>
  <!-- ===== ЭКРАН БАНА ===== -->
  <div class="ban-screen" id="ban-screen">
    <div class="ban-screen-inner">
      <div class="ban-logo">🐱</div>
      <h1 class="ban-title">Котик в тебе разочарован</h1>
      <p class="ban-sub">Твой доступ к CATio ограничен.</p>
      <div class="ban-card">
        <div class="ban-row"><span>Причина</span><b><?php echo htmlspecialchars($banInfo['reason'], ENT_QUOTES, 'UTF-8'); ?></b></div>
        <div class="ban-row"><span>Кто забанил</span><b><?php echo htmlspecialchars($banInfo['banned_by_name'] ?: 'Администратор', ENT_QUOTES, 'UTF-8'); ?></b></div>
        <div class="ban-row"><span>Срок</span><b><?php
          if (!empty($banInfo['banned_until'])) {
            echo 'до ' . htmlspecialchars(date('d.m.Y H:i', strtotime($banInfo['banned_until'])), ENT_QUOTES, 'UTF-8');
          } else {
            echo 'навсегда';
          }
        ?></b></div>
      </div>
      <a class="ban-back-btn" href="?view=auth&logout=1<?php echo $isClient ? '&amp;client=1' : ''; ?>" id="ban-back-auth">Вернуться к авторизации</a>
    </div>
  </div>
  <style>
    #app, .topbar, .sidebar { display: none !important; }
  </style>
  <?php endif; ?>


  <?php if (!empty($unbanNotice)): ?>
  <!-- ===== ЭКРАН РАЗБАНА ===== -->
  <div class="ban-screen unban-screen" id="unban-screen">
    <div class="ban-screen-inner">
      <div class="ban-logo">😺</div>
      <h1 class="ban-title">Котик милостливый пожалел тебя</h1>
      <p class="ban-sub">Больше не ссы мимо лотка.<br>Вы были разблокированы.</p>
      <button type="button" class="ban-back-btn" id="unban-continue-btn">Продолжить</button>
    </div>
  </div>
  <style>
    #app, .topbar, .sidebar { display: none !important; }
  </style>
  <script>
  document.getElementById('unban-continue-btn')?.addEventListener('click', async () => {
    try {
      await fetch('api/admin.php?action=dismiss_unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ csrf_token: window.CSRF_TOKEN || '' })
      });
    } catch (e) {}
    const client = <?php echo $isClient ? 'true' : 'false'; ?>;
    window.location.href = client ? '?view=home&client=1' : '?view=home';
  });
  </script>
  <?php endif; ?>


  <div class="submit-modal hidden" id="privacy-modal">
    <div class="submit-modal-backdrop" data-close-privacy></div>
    <div class="submit-modal-box privacy-modal-box">
      <div class="submit-modal-head">
        <h2>Лицензионное соглашение</h2>
        <button type="button" class="pub-modal-close" id="privacy-modal-close" aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body privacy-modal-body">
        <div class="privacy-hero">
          <div class="privacy-hero-ico">
            <?= icon('shield', 22) ?>
          </div>
          <div>
            <div class="privacy-hero-title">CATio — защита ваших данных</div>
            <div class="privacy-hero-sub">Кратко о том, что мы собираем и зачем</div>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#ef5b2c">
            <?= icon('user', 18) ?>
          </div>
          <div>
            <h4>Какие данные</h4>
            <p>Имя пользователя, e-mail, данные сессии, сведения о библиотеке и покупках — только то, что нужно для аккаунта.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6ea8fe">
            <?= icon('settings', 18) ?>
          </div>
          <div>
            <h4>Зачем это нужно</h4>
            <p>Вход в аккаунт, безопасность, библиотека игр, уведомления и работа сервиса. Без лишней аналитики «для рекламы».</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#6fdf8b">
            <?= icon('lock', 18) ?>
          </div>
          <div>
            <h4>Кому передаём</h4>
            <p>Третьим лицам — только по закону или с вашего согласия. Мы не продаём персональные данные.</p>
          </div>
        </div>
        <div class="privacy-point">
          <div class="privacy-point-ico" style="--c:#f0c14b">
            <?= icon('trash-simple', 18) ?>
          </div>
          <div>
            <h4>Ваши права</h4>
            <p>Можно запросить уточнение или удаление данных — напишите администрации CATio.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

<!-- Модалка оформления игры (как Hydra) -->
<div id="steam-import-modal" class="sgdb-modal hidden" aria-hidden="true">
  <div class="sgdb-modal-backdrop" data-close-steam-modal></div>
  <div class="sgdb-modal-card" role="dialog" aria-modal="true">
    <div class="sgdb-modal-head">
      <h3 id="sgdb-modal-title">Игра</h3>
      <button type="button" class="sgdb-modal-close" data-close-steam-modal aria-label="Закрыть">×</button>
    </div>
    <div class="sgdb-modal-body">
      <aside class="sgdb-nav">
        <button type="button" class="sgdb-nav-btn" data-sgdb-tab="main">
          <?= icon('settings-gear', 16) ?>
          Основные
        </button>
        <button type="button" class="sgdb-nav-btn" data-sgdb-tab="path">
          <?= icon('folder', 16) ?>
          Расположение
        </button>
        <button type="button" class="sgdb-nav-btn active" data-sgdb-tab="assets">
          <?= icon('image', 16) ?>
          Настройка
        </button>
        <button type="button" class="sgdb-nav-btn" data-sgdb-tab="downloads">
          <?= icon('downloads', 16) ?>
          Загрузки
        </button>
        <button type="button" class="sgdb-nav-btn" data-sgdb-tab="mods">
          <?= icon('layers', 16) ?>
          Модификации
        </button>
        <button type="button" class="sgdb-nav-btn sgdb-nav-danger" data-sgdb-tab="danger">
          <?= icon('alert', 16) ?>
          Опасная зона
        </button>
      </aside>
      <div class="sgdb-content">
        <div class="sgdb-pane" data-sgdb-pane="main">
          <div class="sgdb-pane-title">Основные</div>
          <div class="sgdb-info-grid">
            <div class="sgdb-info-row"><span>Название</span><b id="sgdb-info-title">—</b></div>
            <div class="sgdb-info-row"><span>ID в CATio</span><b id="sgdb-info-id">—</b></div>
          </div>
        </div>
        <div class="sgdb-pane" data-sgdb-pane="path">
          <div class="sgdb-pane-title">Файл</div>
          <p class="settings-hint" style="margin:0 0 12px">Путь к файлу, который будет запущен при нажатии на «Играть»</p>
          <div class="sgdb-path-row">
            <div class="sgdb-path-field is-readonly" id="sgdb-exe-path" title="Путь к исполняемому файлу">Файл не выбран</div>
            <button type="button" class="hp-btn-edit sgdb-path-pick" id="sgdb-pick-exe" disabled title="Выбор файла доступен в клиенте">
              <?= icon('file', 14) ?>
              Выбрать
            </button>
          </div>
          <div class="sgdb-path-saves is-readonly" id="sgdb-saves-path">
            <?= icon('folder', 14) ?>
            <span>Папка с сохранениями не найдена</span>
          </div>
          <div class="sgdb-pane-title" style="margin-top:20px">Установка</div>
          <div class="sgdb-path-field is-readonly" id="sgdb-install-path" title="Куда установлена игра">—</div>
        </div>
        <div class="sgdb-pane active" data-sgdb-pane="assets">
          <div class="sgdb-asset-tabs">
            <button type="button" class="sgdb-asset-tab active" data-asset-type="icons">Иконка</button>
            <button type="button" class="sgdb-asset-tab" data-asset-type="logos">Логотип</button>
            <button type="button" class="sgdb-asset-tab" data-asset-type="heroes">Баннер</button>
            <button type="button" class="sgdb-asset-tab" data-asset-type="grids">Обложка</button>
          </div>
          <div class="sgdb-asset-preview-wrap">
            <div class="sgdb-asset-preview checker" id="sgdb-asset-preview">
              <img id="sgdb-asset-preview-img" src="" alt="" />
            </div>
          </div>
          <p class="sgdb-warn">⚠ Ваши пользовательские изображения не будут синхронизированы с вашей учётной записью.</p>
          <div class="sgdb-source-label">CATioGridDB</div>
          <div class="sgdb-asset-scroll">
            <div id="sgdb-asset-grid" class="sgdb-asset-grid">
              <div class="settings-hint">Загрузка…</div>
            </div>
          </div>
          <input type="hidden" id="steam-sel-icon" />
          <input type="hidden" id="steam-sel-logo" />
          <input type="hidden" id="steam-sel-banner" />
          <input type="hidden" id="steam-sel-cover" />
          <div class="sgdb-asset-savebar">
            <span class="sgdb-asset-save-hint" id="sgdb-asset-save-hint">Выбери ассеты и нажми сохранить</span>
            <button type="button" class="auth-submit sgdb-asset-save-btn" id="sgdb-asset-save">Сохранить</button>
          </div>
        </div>
        <div class="sgdb-pane" data-sgdb-pane="downloads">
          <div class="sgdb-pane-title">Загрузки</div>
          <p class="settings-hint" style="margin:0 0 14px">Выберите версию, которая будет запускаться, если скачано несколько сборок.</p>
          <label class="ws-ff" style="margin-bottom:14px">
            <span>Запускаемая версия</span>
            <select class="settings-select" id="sgdb-launch-version" style="width:100%">
              <option value="">Нет установленных версий</option>
            </select>
          </label>
          <p class="settings-hint" id="sgdb-downloads-hint">Проверить наличие обновлений или других версий игры</p>
          <button type="button" class="hp-btn-edit" id="sgdb-open-sources" style="margin-top:10px">Открыть источники</button>
        </div>
        <div class="sgdb-pane" data-sgdb-pane="mods">
          <div class="sgdb-pane-title">Модификации</div>
          <p class="settings-hint" style="margin:0 0 14px">Моды, установленные для этой игры. Включённые будут подхватываться при запуске.</p>
          <div id="sgdb-mods-list" class="sgdb-mods-list"></div>
        </div>
        <div class="sgdb-pane" data-sgdb-pane="danger">
          <div class="sgdb-pane-title">Опасная зона</div>
          <p class="settings-hint" style="margin:0 0 14px">Вы можете удалить эту игру из библиотеки или локальные файлы на устройстве.</p>
          <div class="sgdb-danger-actions" id="sgdb-danger-actions">
            <button type="button" class="btn-danger" id="sgdb-remove-library">Удалить из библиотеки</button>
            <button type="button" class="btn-danger" id="sgdb-refresh-playtime">Обновить время игры</button>
            <button type="button" class="btn-danger" id="sgdb-reset-playtime">Сбросить время игры</button>
            <button type="button" class="btn-danger" id="sgdb-delete-files">Удалить файлы</button>
          </div>
          <div class="sgdb-pane-title" style="margin-top:22px">Мои скриншоты</div>
          <div class="sgdb-danger-actions" id="sgdb-shots-actions">
            <button type="button" class="btn-danger" id="sgdb-del-all-shots" disabled title="Нет скриншотов">Удалить все скриншоты</button>
            <button type="button" class="btn-danger" id="sgdb-del-pub-shots" disabled title="Нет опубликованных">Удалить все опубликованные скриншоты</button>
            <button type="button" class="btn-danger" id="sgdb-del-local-shots" disabled title="Нет локальных">Удалить локальные скриншоты</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>


  <!-- Модалка: обновить время игры -->
  <div class="submit-modal hidden" id="playtime-edit-modal">
    <div class="submit-modal-backdrop" data-close-playtime></div>
    <div class="submit-modal-box app-confirm-box" style="max-width:440px">
      <div class="submit-modal-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px 0">
        <div>
          <h2 class="app-confirm-title" style="margin:0 0 4px;text-align:left" id="playtime-edit-title">Обновить время игры</h2>
          <p class="app-confirm-sub" style="margin:0;text-align:left" id="playtime-edit-sub">Вручную обновите время игры</p>
        </div>
        <button type="button" class="pub-modal-close" data-close-playtime aria-label="Закрыть">
          <?= icon('x', 18) ?>
        </button>
      </div>
      <div class="submit-modal-body" style="padding:16px 20px 20px">
        <div class="playtime-warn">
          <span aria-hidden="true">⚠</span>
          <span>Ваши часы будут отмечены как обновлённые вручную. Убрать эту отметку можно только сбросив время игры.</span>
        </div>
        <div class="playtime-fields">
          <label class="ws-ff">
            <span>часов</span>
            <input type="number" min="0" max="99999" step="1" id="playtime-hours" class="settings-input" value="0" />
          </label>
          <label class="ws-ff">
            <span>минут</span>
            <input type="number" min="0" max="59" step="1" id="playtime-minutes" class="settings-input" value="0" />
          </label>
        </div>
        <div class="app-confirm-actions" style="justify-content:flex-end;margin-top:16px">
          <button type="button" class="hp-btn-edit" data-close-playtime>Отменить</button>
          <button type="button" class="btn-danger" id="playtime-edit-save">Обновить время игры</button>
        </div>
      </div>
    </div>
  </div>

<!-- ===== Модалка установки игры ===== -->
<div class="submit-modal hidden" id="install-modal">
  <div class="submit-modal-backdrop" data-close-install></div>
  <div class="submit-modal-box" style="max-width:440px">
    <div class="submit-modal-head">
      <h2>Установить</h2>
      <button type="button" class="pub-modal-close" data-close-install aria-label="Закрыть">
        <?= icon('x', 18) ?>
      </button>
    </div>
    <div class="submit-modal-body">
      <div class="install-game-row">
        <div class="install-game-cover" id="install-cover"></div>
        <div class="install-game-meta">
          <div class="install-game-title" id="install-title">Игра</div>
          <div class="install-game-size" id="install-size">—</div>
        </div>
      </div>
      <label class="ws-ff" style="margin-top:14px">
        <span>Версия</span>
        <select class="settings-select" id="install-version" style="width:100%"></select>
      </label>
      <p class="settings-hint" style="margin-top:10px">Файлы: AppData\Roaming\CATio\games\…</p>
    </div>
    <div class="submit-modal-foot">
      <button type="button" class="hp-btn-edit" data-close-install>Отмена</button>
      <button type="button" class="hp-btn-edit" id="install-confirm" style="background:var(--accent);color:#12110e;border-color:var(--accent)">Установить</button>
    </div>
  </div>
</div>

