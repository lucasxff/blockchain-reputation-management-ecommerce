<?php
/*
Plugin Name: Blockchain-Feedback-Ecommerce
Description: Request feedback after purchase on WooCommerce and integrates DID with blockchain.
Version: 1.0
Author: Lucas Fernandes
*/

putenv('OPENSSL_CONF=C:/Program Files/OpenSSL-Win64/bin/openssl.cnf');

function create_or_update_feedback_table()
{
    global $wpdb;
    $table_name = $wpdb->prefix . 'blockchain_feedbacks';

    $charset_collate = $wpdb->get_charset_collate();

    $sql = "CREATE TABLE IF NOT EXISTS $table_name (
        feedback_id BIGINT(20) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT(20) UNSIGNED NOT NULL,  
        rater_did VARCHAR(100) NOT NULL,  
        subject_did VARCHAR(100) NOT NULL,  
        product_id BIGINT(20) UNSIGNED NOT NULL, 
        order_id BIGINT(20) UNSIGNED NOT NULL, 
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, 
        payload TEXT NOT NULL 
    ) $charset_collate;";

    require_once(ABSPATH . 'wp-admin/includes/upgrade.php');
    dbDelta($sql);
}

register_activation_hook(__FILE__, 'create_or_update_feedback_tables');

function create_or_update_feedback_tables()
{
    create_or_update_feedback_table();
}

add_action('plugins_loaded', 'create_or_update_feedback_table');

function add_connect_eid_button($location = 'account')
{
    $user_id = get_current_user_id();
    $did = get_user_meta($user_id, 'did', true);
    $store_url = get_site_url();
    $button_id = ($location == 'account') ? 'connectEidButton' : 'connectEidButtonCheckout';
    $legend = ($location == 'account') ? 'Connect to RMB' : 'Connect to RMB (Checkout)';

    if (!$did) {
        echo '<fieldset>
                <legend>' . $legend . '</legend>
                <p>
                    <input type="submit" id="' . $button_id . '"value="Click here to connect your EID"/>
                </p>
              </fieldset>';

        echo '<script>
                document.getElementById("' . $button_id . '").onclick = function() {
                    window.open("http://localhost:3000/register.html?user_id=' . $user_id . '&store_url=' . $store_url . '", "_blank");
                };
              </script>';
    } else {
        echo '<fieldset>
                <legend>' . $legend . '</legend>
                <p><strong>DID:</strong> ' . esc_attr($did) . '</p>
              </fieldset>';
    }
}

function send_feedback_to_api($feedbackData)
{
    $api_url = 'http://localhost:3000/api/feedback';
    $current_url = (isset($_SERVER['HTTPS']) ? "https" : "http") . "://$_SERVER[HTTP_HOST]$_SERVER[REQUEST_URI]"; // Capture the current URL

    $feedbackData['returnUrl'] = $current_url;


    $response = wp_remote_post($api_url, array(
        'method'    => 'POST',
        'headers'   => array('Content-Type' => 'application/json; charset=utf-8'),
        'body'      => wp_json_encode($feedbackData),
        'data_format' => 'body',
    ));

    if (is_wp_error($response)) {
        return array('error' => true, 'message' => $response->get_error_message());
    }

    $response_body = wp_remote_retrieve_body($response);
    $data = json_decode($response_body, true);

    if (isset($data['link'])) {
        return array('error' => false, 'link' => $data['link']);
    } else {
        return array('error' => true, 'message' => $data['message'] ?? 'Unknown API error.');
    }
}

add_action('woocommerce_edit_account_form', function () {
    add_connect_eid_button('account');
});

add_action('wp_enqueue_scripts', function () {
    wp_enqueue_style('dashicons');
});

add_action('woocommerce_after_checkout_billing_form', function () {
    add_connect_eid_button('checkout');
});

add_action('rest_api_init', function () {
    register_rest_route('blockchain-feedback/v1', '/update-did', array(
        'methods' => 'POST',
        'callback' => 'update_did_callback',
    ));
});

function update_did_callback(WP_REST_Request $request)
{
    $user_id = $request['user_id'];
    $did = $request['did'];

    if (!$user_id || !$did) {
        return new WP_Error('invalid_data', 'User ID and DID are required.', array('status' => 400));
    }

    update_user_meta($user_id, 'did', sanitize_text_field($did));

    return rest_ensure_response(array('message' => 'DID successfully updated.'));
}

function show_feedback_modal($order_id, $did, $product_id, $customer_email, $customer_name)
{
    echo '<script type="text/javascript">
     var ajaxurl = "' . admin_url('admin-ajax.php') . '";
 </script>';

    echo '<style>
 .modal {
     display: none;
     position: fixed;
     z-index: 1;
     left: 0;
     top: 0;
     width: 100%;
     height: 100%;
     overflow: auto;
     background-color: rgba(0,0,0,0.4);
 }
 .modal-content {
     background-color: #fefefe;
     margin: 15% auto;
     padding: 20px;
     border: 1px solid #888;
     width: 50%;
 }
 .close {
     color: #aaa;
     float: right;
     font-size: 28px;
     font-weight: bold;
 }
 .close:hover, .close:focus {
     color: black;
     text-decoration: none;
     cursor: pointer;
 }
 #qr-code {
     margin-top: 20px;
     display: flex;
     justify-content: center;
 }
 #confirmFeedbackButton {
     display: none; /* Hide the button initially */
     margin-top: 20px;
 }
 input[type=checkbox], input[type=radio] {   
    margin-right: 5px;
}
.content textarea {
    margin: 15px 0px;
}
 </style>';

    echo '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>'; // Includes the QRCode.js library

    echo '<div id="feedback-modal" class="modal">
        <div class="modal-content">
            <span class="close">&times;</span>
            <h2>Please rate us</h2>
            <div id="feedbackSubmitted" style="display: none;">
                <p>You have already submitted feedback for this purchase.</p>
                <button onclick="document.getElementById(\'feedback-modal\').style.display=\'none\'">OK</button>
            </div>
            <form id="feedbackForm" style="display: none;">
                <div class="rating">
                <label><input type="radio" name="product_rating" value="5"/> ' . str_repeat('<span class="dashicons dashicons-star-filled"></span>', 5) . ' 5 stars</label><br/>
                <label><input type="radio" name="product_rating" value="4"/> ' . str_repeat('<span class="dashicons dashicons-star-filled"></span>', 4) . ' 4 stars</label><br/>
                <label><input type="radio" name="product_rating" value="3"/> ' . str_repeat('<span class="dashicons dashicons-star-filled"></span>', 3) . ' 3 stars</label><br/>
                <label><input type="radio" name="product_rating" value="2"/> ' . str_repeat('<span class="dashicons dashicons-star-filled"></span>', 2) . ' 2 stars</label><br/>
                <label><input type="radio" name="product_rating" value="1"/> ' . str_repeat('<span class="dashicons dashicons-star-filled"></span>', 1) . ' 1 star</label><br/>    </div>
        
                <div>
                <p style="margin-top: 10px;">Write a review about your purchase</p>
                  <textarea id="w3review" name="comment" rows="4" cols="50"></textarea>
                </div>
                <input type="hidden" id="product_id" name="product_id" value="' . esc_attr($product_id) . '">
                <input type="hidden" id="email" name="email" value="' . esc_attr($customer_email) . '">
                <input type="hidden" id="author" name="author" value="' . esc_attr($customer_name) . '">
                <input type="hidden" id="order_id" name="order_id" value="' . esc_attr($order_id) . '">
                <input type="hidden" id="did" name="did" value="' . esc_attr($did) . '">
                <input type="hidden" id="returnUrl" name="returnUrl" value="' . esc_attr($_SERVER['REQUEST_URI']) . '">
                <input type="submit" value="Submit Feedback"/>
            </form>
            <div id="qr-code"></div>
            <input type="submit" value="Confirm Feedback" id="confirmFeedbackButton" style="display:none; margin-top: 20px;  margin: 20px auto;"/>
        </div>
    </div>';

    echo "<script>
    document.getElementById('submitFeedbackButton').addEventListener('click', function() {
        checkFeedbackSubmitted(); // Check if feedback was already submitted when clicking the button
    });

    document.getElementById('feedbackForm').addEventListener('submit', function(event) {
        event.preventDefault();
     
        // Tenta obter o valor da classificação do produto
        var productRatingInput = document.querySelector('input[name=\"product_rating\"]:checked');
        
        // Verifica se o valor de rating foi selecionado
        if (!productRatingInput) {
            alert('Please select a rating before submitting.');
            return; // Interrompe a submissão se o valor não foi selecionado
        }
     
        // Coleta os dados do comentário
        var comment = document.getElementById('w3review').value;
     
        // Verifica se o comentário foi preenchido
        if (comment.trim() === '') {
            alert('Please enter a comment.');
            return; // Interrompe a submissão se o comentário estiver vazio
        }
     
        // Cria o payload corretamente como um array de objetos
        var feedbackData = {
            did: document.getElementById('did').value,
            product_id: parseInt(document.getElementById('product_id').value, 10), // Converte para número
            order_id: document.getElementById('order_id').value,
            author: document.getElementById('author').value,
            payload:  {
                        rating: parseInt(productRatingInput.value, 10),  // Converte para número
                        comment: comment
                    }                            
        };
     
        var returnUrl = window.location.href;
     
        console.log('Feedback data:', feedbackData);
     
        jQuery.ajax({
            url: ajaxurl,
            type: 'POST',
            dataType: 'json',
            data: {
                action: 'save_feedback',
                data: feedbackData,
                returnUrl: returnUrl
            },
            success: function(response) {
                console.log('Response from server:', response);
     
                if (response.success) {
                    var confirmationUrlWithReturn = response.data.link + '&returnUrl=' + encodeURIComponent(returnUrl);
                    console.log(confirmationUrlWithReturn);
                    if (response.data.link) {
                        // Adiciona o botão e o QR code para confirmar o feedback
                        document.getElementById('confirmFeedbackButton').style.display = 'block';
                        document.getElementById('confirmFeedbackButton').onclick = function() {
                            window.open(confirmationUrlWithReturn, '_blank');
                        };
     
                        var qrCodeDiv = document.getElementById('qr-code');
                        qrCodeDiv.innerHTML = ''; // Limpa o QR Code anterior, se houver
                        var qrCode = new QRCode(qrCodeDiv, {
                            text: confirmationUrlWithReturn,
                            width: 128,
                            height: 128
                        });
                    }
                } else {
                    alert(response.data.message);
                }
            },
            error: function(error) {
                console.error('Error from server:', error);
                alert('Error saving feedback. Please try again.');
            }
        });
    });
    
    
    function checkFeedbackSubmitted() {
        var orderId = ' . $order_id . ';

        jQuery.ajax({
            url: ajaxurl,
            type: 'POST',
            data: {
                action: 'check_feedback_submitted',
                order_id: orderId
            },
            success: function(response) {
                if(response.submitted) {
                    // If feedback has already been submitted, show message
                    document.getElementById('feedbackForm').style.display = 'none';
                    document.getElementById('feedbackSubmitted').style.display = 'block';
                } else {
                    // If feedback has not been submitted, show the form
                    document.getElementById('feedbackSubmitted').style.display = 'none';
                    document.getElementById('feedbackForm').style.display = 'block';
                }

                var modal = document.getElementById('feedback-modal');
                modal.style.display = 'block';
            },
            error: function(error) {
                console.error('Error checking feedback submission:', error);
                alert('Error checking feedback. Please try again.');
            }
        });
    }

    </script>";
}

add_action('wp_ajax_check_feedback_submitted', 'check_feedback_submitted_callback');
add_action('wp_ajax_nopriv_check_feedback_submitted', 'check_feedback_submitted_callback');

function check_feedback_submitted_callback()
{
    global $wpdb;
    $table_name = $wpdb->prefix . 'blockchain_feedbacks';

    $order_id = intval($_POST['order_id']);
    $feedback_existente = $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM $table_name WHERE order_id = %d",
        $order_id
    ));

    if ($feedback_existente > 0) {
        wp_send_json_success(['submitted' => true]);
    } else {
        wp_send_json_success(['submitted' => false]);
    }
}

add_action('woocommerce_thankyou', 'show_feedback_after_purchase');

function show_feedback_after_purchase($order_id)
{
    $order = wc_get_order($order_id);
    $user_id = get_current_user_id();
    $did = get_user_meta($user_id, 'did', true);
    $items = $order->get_items();
    $product_id = 0;

    if (!empty($items)) {
        foreach ($items as $item) {
            if ($item instanceof WC_Order_Item_Product) {
                $product_id = $item->get_product_id();
                break;
            }
        }
    }

    $customer_email = $order->get_billing_email();
    $customer_name = $order->get_billing_first_name() . ' ' . $order->get_billing_last_name();

    show_feedback_modal($order_id, $did, $product_id, $customer_email, $customer_name);
}

add_action('rest_api_init', function () {
    register_rest_route('blockchain-feedback/v1', '/get-feedbacks', array(
        'methods' => 'GET',
        'callback' => 'get_feedbacks_callback',
        'permission_callback' => '__return_true'
    ));
});

function get_feedbacks_callback(WP_REST_Request $request)
{
    global $wpdb;
    $table_name = $wpdb->prefix . 'blockchain_feedbacks';

    $feedbacks = $wpdb->get_results("SELECT * FROM $table_name");

    if (!$feedbacks) {
        return rest_ensure_response(array('message' => 'No feedbacks found.'));
    }

    return rest_ensure_response($feedbacks);
}


add_action('woocommerce_order_details_after_order_table', 'add_feedback_button_order');

function add_feedback_button_order($order)
{
    $order_id = $order->get_id();

    global $wpdb;
    $table_name = $wpdb->prefix . 'blockchain_feedbacks';
    $feedback_existente = $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM $table_name WHERE order_id = %d",
        $order_id
    ));

    if ($feedback_existente > 0) {
        echo '<p>You have already submitted feedback for this purchase.</p>';
    } else {
        echo '<input type="submit" id="submitFeedbackButton" style="margin-top: 20px; margin-bottom: 20px;" value="Submit feedback on your purchase"/>';

        echo '<script>
            document.getElementById("submitFeedbackButton").onclick = function() {
                var modal = document.getElementById("feedback-modal");
                modal.style.display = "block";
            };
        </script>';

        show_feedback_after_purchase($order_id);
    }
}

add_action('wp_ajax_save_feedback', 'save_feedback_callback');
add_action('wp_ajax_nopriv_save_feedback', 'save_feedback_callback');

function save_feedback_callback()
{
    global $wpdb;
    $table_name = $wpdb->prefix . 'blockchain_feedbacks';

    $data = $_POST['data'];
    $returnUrl = $_POST['returnUrl'];

    $feedback_existente = $wpdb->get_var($wpdb->prepare(
        "SELECT COUNT(*) FROM $table_name WHERE order_id = %d",
        $data['order_id']
    ));

    if ($feedback_existente > 0) {
        wp_send_json_error(['message' => 'This purchase already has feedback.']);
    }

    $subject_did = get_option('blockchain_ecommerce_did');
    if (!$subject_did) {
        wp_send_json_error(['message' => 'E-commerce DID not set.']);
    }

    $private_key = get_option('blockchain_ecommerce_private_key');
    if (!$private_key) {
        wp_send_json_error(['message' => 'E-commerce private key not set.']);
    }

    if (!isset($data['payload']) || !is_array($data['payload'])) {
        wp_send_json_error(['message' => 'Payload not found or in the wrong format.']);
    }

    $wpdb->insert($table_name, [
        'user_id' => get_current_user_id(),
        'rater_did' => sanitize_text_field($data['did']),
        'subject_did' => sanitize_text_field($subject_did),
        'product_id' => intval($data['product_id']),
        'order_id' => intval($data['order_id']),
        'timestamp' => current_time('mysql'),
        'payload' => json_encode($data['payload'])
    ]);

    $feedback_salvo = $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM $table_name WHERE order_id = %s",
        $data['order_id']
    ));

    if (!$feedback_salvo) {
        wp_send_json_error(['message' => 'Error retrieving the saved feedback.']);
    }

    $feedback_json_ld = [
        '@context' => ['https://consortium/feedback.jsonld'],
        'id' => $feedback_salvo->feedback_id,
        'platform' => $feedback_salvo->subject_did,
        'order' => $feedback_salvo->order_id,
    ];



    $feedback_json_string = wp_json_encode($feedback_json_ld);


    if (!is_string($feedback_json_string)) {
        return "Error: O JSON-LD generated is not a valid string.";
    }


    $encrypted_data = encrypt_message_with_private_key($feedback_json_string);

    $feedbackData = [
        'encrypted_feedback' => $encrypted_data,
        'did' => get_option('blockchain_ecommerce_did'),
        'returnUrl' => $returnUrl,
    ];

    $api_response = send_feedback_to_api($feedbackData);

    if ($api_response['error']) {
        wp_send_json_error(['message' => 'Error sending feedback to the API:' . $api_response['message']]);
    }

    wp_send_json_success(['message' => 'Feedback successfully sent to API.', 'link' => $api_response['link']]);
}

add_action('admin_menu', 'blockchain_feedback_ecommerce_menu');

add_action('rest_api_init', function () {
    register_rest_route('blockchain-feedback/v1', '/get-feedback-by-id', array(
        'methods' => 'GET',
        'callback' => 'get_feedback_by_id_callback',
        'args' => [
            'feedback_id' => [
                'required' => true,
                'validate_callback' => function ($param) {
                    return is_string($param);
                }
            ],
            'order_id' => [
                'required' => true,
                'validate_callback' => function ($param) {
                    return is_numeric($param);
                }
            ],
        ],
        'permission_callback' => '__return_true' // Permite acesso público
    ));
});

function get_feedback_by_id_callback(WP_REST_Request $request)
{
    global $wpdb;
    $table_name = $wpdb->prefix . 'blockchain_feedbacks';
    $feedback_id = sanitize_text_field($request->get_param('feedback_id'));
    $order_id = intval($request->get_param('order_id'));

    $feedback_salvo = $wpdb->get_row($wpdb->prepare(
        "SELECT * FROM $table_name WHERE feedback_id = %s AND order_id = %d",
        $feedback_id,
        $order_id
    ));

    if (!$feedback_salvo) {
        return new WP_Error('feedback_not_found', 'Feedback not found with the provided ID and Order ID.', array('status' => 404));
    }

    $feedback_json_ld = [
        '@context' => ['https://consortium/feedback.jsonld'],
        'id' => $feedback_salvo->feedback_id,
        'platform' => $feedback_salvo->subject_did,
        'order' => $feedback_salvo->order_id,
        'subject' => $feedback_salvo->subject_did,
        'rater' => $feedback_salvo->rater_did,
        'timestamp' => gmdate('Y-m-d\TH:i:s.v', strtotime($feedback_salvo->timestamp)),
        'feedback' => [
            'stars' => intval(json_decode($feedback_salvo->payload)->rating),
            'comment' => sanitize_text_field(json_decode($feedback_salvo->payload)->comment),
        ]
    ];

    return rest_ensure_response($feedback_json_ld);
}

function blockchain_feedback_ecommerce_menu()
{
    add_menu_page(
        'Blockchain Feedback',
        'Blockchain Feedback',
        'manage_options',
        'blockchain-feedback-ecommerce',
        'blockchain_feedback_ecommerce_page',
        'dashicons-admin-network',
        90
    );
}

function blockchain_feedback_ecommerce_page()
{
    $ecommerceDid = get_option('blockchain_ecommerce_did');
    $siteUrl = esc_url(site_url());

    echo '<div class="wrap">';
    echo '<h1>Connect E-Commerce Platform</h1>';

    if (!$ecommerceDid) {
        echo '<input type="submit" id="connectEIDButton" style="margin-bottom: 20px;" value="Connect E-Commerce Platform"/>';
    } else {
        echo '<p><strong>E-commerce DID:</strong> ' . esc_attr($ecommerceDid) . '</p>';
    }

    echo '</div>';

    if (!$ecommerceDid) {
        echo '<script>
            document.getElementById("connectEIDButton").onclick = function() {
                window.open("http://localhost:3000/connect-ecommerce.html?siteUrl=' . $siteUrl . '", "_blank");
            };
        </script>';
    }
}

add_action('rest_api_init', function () {
    register_rest_route('blockchain-feedback/v1', '/update-ecommerce-credentials', array(
        'methods' => 'POST',
        'callback' => 'update_ecommerce_credentials_callback',
    ));
});

function update_ecommerce_credentials_callback(WP_REST_Request $request)
{
    // Usar get_json_params para pegar os dados da requisição JSON
    $params = $request->get_json_params();

    $did = isset($params['did']) ? $params['did'] : null;

    // Verificar se o DID e a chave privada foram fornecidos
    if (!$did) {
        return new WP_Error('invalid_data', 'DID is required.', array('status' => 400));
    }
    update_option('blockchain_ecommerce_did', sanitize_text_field($did));

    $public_key = generate_rsa_keys();

    if (is_array($public_key) && isset($public_key['error'])) {
        error_log("Key generation error: " . $public_key['error']); // Log de erro de geração de chave
        return new WP_Error('key_generation_failed', 'Key generation failed.', array('status' => 500));
    }


    return rest_ensure_response(array('publicKey' => $public_key)); // Corrigido para 'publicKey'
}

function generate_rsa_keys()
{
    $config = array(
        "digest_alg" => "sha256",
        "private_key_bits" => 2048,
        "private_key_type" => OPENSSL_KEYTYPE_RSA,
    );

    $res = openssl_pkey_new($config);

    if (!$res) {
        $error = openssl_error_string();
        error_log("OpenSSL error: " . $error); // Log de erro
        return array('error' => 'Failed to generate keys: ' . $error);
    }

    openssl_pkey_export($res, $private_key);

    $public_key_details = openssl_pkey_get_details($res);
    $public_key = $public_key_details['key'];

    update_option('encryption_private_key', $private_key);
    update_option('encryption_public_key', $public_key);

    error_log("Public key generated successfully."); // Log de sucesso


    return $public_key;
}

function encrypt_message_with_private_key($message)
{
    $private_key = get_option('encryption_private_key');
    openssl_private_encrypt($message, $encrypted_message, $private_key);
    return base64_encode($encrypted_message);
}

function decrypt_message_with_public_key($encrypted_message)
{
    $public_key = get_option('encryption_public_key');
    $encrypted_message = base64_decode($encrypted_message);
    openssl_public_decrypt($encrypted_message, $decrypted_message, $public_key);
    return $decrypted_message; // Retorna a mensagem descriptografada
}

add_shortcode('display_product_feedbacks', 'display_product_feedbacks_callback');

function display_product_feedbacks_callback($atts)
{
    global $wpdb;

    $atts = shortcode_atts([
        'product_id' => get_the_ID()
    ], $atts);

    $table_name = $wpdb->prefix . 'blockchain_feedbacks';

    $feedbacks = $wpdb->get_results($wpdb->prepare("SELECT * FROM $table_name WHERE product_id = %d", $atts['product_id']));

    $output = '';

    if ($feedbacks) {
        $output .= '<h2 class="feedback-list">Product Feedback List</h2>';
        foreach ($feedbacks as $feedback) {
            $user_avatar = get_avatar($feedback->user_id, 64);
            $userData = get_userdata($feedback->user_id);

            $payload = json_decode($feedback->payload, true);

            if (isset($payload['rating']) && isset($payload['comment'])) {
                $rating = esc_html($payload['rating']);
                $comment = esc_html($payload['comment']);
            } else {
                $rating = 'N/A';
                $comment = 'No comment provided.';
            }

            $feedback_json_ld = [
                '@context' => ['https://consortium/feedback.jsonld'],
                'id' => $feedback->feedback_id,
                'platform' => $feedback->subject_did,
                'order' => $feedback->order_id,
                'subject' => $feedback->subject_did,
                'rater' => $feedback->rater_did,
                'timestamp' => gmdate('Y-m-d\TH:i:s.v', strtotime($feedback->timestamp)),
                'feedback' => [
                    'stars' => intval(json_decode($feedback->payload)->rating),
                    'comment' => sanitize_text_field(json_decode($feedback->payload)->comment),
                ]
            ];

            $feedback_json = wp_json_encode($feedback_json_ld, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

            $json_download_link = 'data:application/json;charset=utf-8,' . rawurlencode($feedback_json);


            $validation_url = "http://localhost:4000/wallet/verify?jsonFeedback=" . rawurlencode($feedback_json);

            $output .= '<div style="display:flex; gap:10px; align-items: center; margin: 30px 0px; justify-content: space-between;">';
            $output .= '<div style="display:flex; gap:10px; align-items: center; margin: 30px 0px">';
            $output .= '<div class="feedback-avatar">' . $user_avatar . '</div>';
            $output .= '<div class="feedback-content">';
            $output .= '<strong>' . esc_html($userData->display_name) . '</strong><br>';
            $output .= esc_html($feedback->timestamp) . '<br>';
            $output .= '<strong>Rating:</strong> ' . $rating . ' stars<br>';
            $output .= '<strong>Comment:</strong> ' . $comment . '<br>';
            $output .= '</div>';
            $output .= '</div>';

            $output .= '<div class="dropdown" style="margin-top: 10px; position:relative;">';
            $output .= '<button class="dropbtn" style="background-color: green; color: white; border: none; padding: 5px 10px; cursor: pointer;">Options</button>';
            $output .= '<div class="dropdown-content" style="display:none; position: absolute; background-color: white; box-shadow: 0px 8px 16px rgba(0, 0, 0, 0.2); z-index: 1;">';
            $output .= '  <ul class="dropdown-menu" style="list-style-type: none; padding: 0; margin: 0;">'; // Remove bullet points and adjust padding/margin

            $output .= '<li style="padding: 8px;"><a href="' . $json_download_link . '" download="feedback-' . $feedback->feedback_id . '.json" style="text-decoration: none; color: black;">Download Feedback JSON</a></li>';
            $output .= '<li style="padding: 8px;"><a href="javascript:void(0);" onclick="openModal(\'' . esc_url($validation_url) . '\')" style="text-decoration: none; color: black;">Validate Feedback with my Wallet</a></li>';
            $output .= '<li style="padding: 8px;"><a href="#" style="text-decoration: none; color: black;">Check this user\'s reputation</a></li>';
            $output .= '  </ul>';
            $output .= '</div>';

            $output .= '</div>';
            $output .= '</div>';
        }
    } else {
        $output .= '<p>No feedbacks for this product.</p>';
    }

    $output .= '
  <div id="feedbackModal" class="modal">
    <div class="modal-content">
      <span class="close">&times;</span>
      <h2>Validate Feedback</h2>
      <div id="qr-code"></div>
      <button id="validateButton" class="validate-button">Validate Feedback with my Wallet</button>
    </div>
  </div>';

    $output .= '
  <style>
  /* Modal container */
  .modal {
    display: none; /* Hidden by default */
    position: fixed; /* Stay in place */
    z-index: 100; /* Sit on top */
    left: 0;
    top: 0;
    width: 100%; /* Full width */
    height: 100%; /* Full height */
    overflow: auto; /* Enable scroll if needed */
    background-color: rgba(0, 0, 0, 0.5); /* Black w/ opacity */
  }

  /* Modal content */
  .modal-content {
    background-color: #fefefe;
    margin: 15% auto; /* 15% from the top and centered */
    padding: 20px;
    border: 1px solid #888;
    width: 40%; /* Could be more or less, depending on screen size */
    text-align: center;
  }

  /* Close button */
  .close {
    color: #aaa;
    float: right;
    font-size: 28px;
    font-weight: bold;
  }

  .close:hover,
  .close:focus {
    color: black;
    text-decoration: none;
    cursor: pointer;
  }

  /* QR code styling */
  #qr-code {
    margin: 20px auto;
    display: flex;
    justify-content: center;
  }

  /* Button to validate */
  .validate-button {
    margin-top: 20px;
    background-color: #6a1b9a;
    color: white;
    padding: 10px 20px;
    border: none;
    cursor: pointer;
  }
  </style>';

    $output .= '
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
  // Get modal elements
  const modal = document.getElementById("feedbackModal");
  const closeModal = document.querySelector(".close");
  const validateButton = document.getElementById("validateButton");

  // Function to open the modal
  function openModal(validationUrl) {
    modal.style.display = "block";
    
    // Generate the QR code
    const qrCodeDiv = document.getElementById("qr-code");
    qrCodeDiv.innerHTML = ""; // Clear previous QR code
    const qrCode = new QRCode(qrCodeDiv, {
      text: validationUrl,
      width: 128,
      height: 128,
    });

    // Set button link
    validateButton.onclick = function() {
      window.open(validationUrl, "_blank");
    };
  }

  // Close modal when clicking on the close button
  closeModal.onclick = function() {
    modal.style.display = "none";
  };

  // Close modal if the user clicks outside the modal content
  window.onclick = function(event) {
    if (event.target === modal) {
      modal.style.display = "none";
    }
  };

  // Handle dropdown toggle
  document.querySelectorAll(".dropbtn").forEach(function(button) {
      button.addEventListener("click", function() {
          let dropdown = this.nextElementSibling;
          dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
      });
  });

  window.onclick = function(event) {
      if (!event.target.matches(".dropbtn")) {
          document.querySelectorAll(".dropdown-content").forEach(function(dropdown) {
              dropdown.style.display = "none";
          });
      }
  };
  </script>';

    return $output;
}
