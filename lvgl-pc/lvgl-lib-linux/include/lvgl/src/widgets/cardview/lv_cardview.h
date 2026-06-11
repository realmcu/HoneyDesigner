/*
 * Copyright (c) 2026, Realtek Semiconductor Corporation
 *
 * SPDX-License-Identifier: MIT
 */

/**
 * @file lv_cardview.h
 *
 */


#ifndef LV_CARDVIEW_H
#define LV_CARDVIEW_H

#ifdef __cplusplus
extern "C" {
#endif

/*********************
 *      INCLUDES
 *********************/
#include "../../lv_conf_internal.h"

#if LV_USE_CARDVIEW != 0

#include "../../core/lv_obj.h"
#include "../../core/lv_obj_private.h"

/*********************
 *      DEFINES
 *********************/
#define RECORD_NUM 5
/**********************
 *      TYPEDEFS
 **********************/

/*Card style enumeration*/
typedef enum
{
    CARD_CLASSIC,
    CARD_STACK,
    CARD_CIRCLE,
    CARD_ZOOM,
} CARDSTYLE;

/*Card user data structure*/
typedef struct
{
    int16_t index;      // Card index
    int16_t start_y;    // Initial Y-axis position
} CardData;

/*Card container user data structure*/
typedef struct
{
    CARDSTYLE style;             // Card style
    int16_t total_num;           // Total number of cards
    int16_t total_length;        // Total length of all cards
    int16_t card_height;         // Height of a single card
    int16_t card_space;          // Space between two cards
    int16_t offset;              // Scroll offset
    int16_t stack_location;      // the distance from stack location to the screen bottom, only support CARD_STACK style
    uint8_t keep_card_num;       // Number of created notes.
    uint16_t created_card_index; // Index of the last created card.
    int16_t speed;
    int16_t record[RECORD_NUM];
    lv_timer_t *timer;           // Timer for inertial motion

    void (* card_design)(lv_obj_t *obj, void *param);
    void *design_param;
} CardViewData;

/*Data of cardviewate*/
typedef struct {
    lv_obj_t obj;
    CardViewData data;
} lv_cardview_t;

typedef struct {
    lv_obj_t obj;
    CardData data;
} lv_card_t;


LV_ATTRIBUTE_EXTERN_DATA extern const lv_obj_class_t lv_cardview_class;

/**********************
 * GLOBAL PROTOTYPES
 **********************/

/**
 * Create a cardview object
 * @param parent    pointer to an object, it will be the parent of the new cardview
 * @return          pointer to the created bar
 */
lv_obj_t * lv_cardview_create(lv_obj_t * parent);

/**
 * @brief Custom card view widget which custom card widget nested in
 * @param parent Parent object.
 * @param style Card move style (CARD_CLASSIC or CARD_STACK).
 * @param card_height Height of each card.
 * @param card_space Space between two cards.
 * @param stack_location Card stack location.
 * @return Pointer to the created card view object.
 */
lv_obj_t *lv_card_view_create(lv_obj_t *parent,
                              CARDSTYLE style,
                              int16_t card_height,
                              int16_t card_space,
                              int16_t stack_location,
                              int16_t total_num,
                              void (* card_design)(lv_obj_t *obj, void *param),
                              void *design_param);

/*======================
 * Add/remove functions
 *=====================*/

/**
 * Create a card object
 * @param parent    pointer to an object, it will be the parent of the new cardview
 * @return          pointer to the created bar
 */
lv_obj_t * lv_card_create(lv_obj_t * parent);

/**
 * @brief Custom card view widget which custom card widget nested in.
 * @param parent Parent object.
 * @param index Card index.
 * @return Pointer to the created card object.
 */
lv_obj_t *lv_card_create_with_index(lv_obj_t *parent, int16_t index);

/*=====================
 * Setter functions
 *====================*/

/**
 * @brief Set card_view offset.
 * @param card_view Card_view.
 * @param offset Offset.
 */
void lv_card_view_set_offset(lv_obj_t *card_view, int16_t offset);

/**
 * @brief Set card_view' number of cards.
 * @param card_view Card_view.
 * @param total_num total number of cards.
 */
void lv_card_view_set_number(lv_obj_t *card_view, int16_t total_num);

/*=====================
 * Getter functions
 *====================*/

/*=====================
 * Other functions
 *====================*/

/**********************
 *      MACROS
 **********************/

#endif /*LV_USE_CARDVIEW*/

#ifdef __cplusplus
} /*extern "C"*/
#endif

#endif /*LV_CARDVIEW_H*/
